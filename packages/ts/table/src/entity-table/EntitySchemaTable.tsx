import type { Column, ListSchema } from '@bbux/types';
import { useModals } from '@bbux/ui';
import {
  type ColumnDef,
  type ColumnSizingState,
  getCoreRowModel,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Dot,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { RelativeTime } from './helpers/RelativeTime';
import { Banner } from './helpers/Banner';
import { EmptyState } from './helpers/EmptyState';
import { Button } from '../button';
import { Checkbox } from '../checkbox';
import { Skeleton } from '../skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../table';
import type { CellProps } from './cells';
import { cn } from '../cn';
import {
  getPath,
  groupingPath,
  renderCell,
  resolveFilterColor,
  resolveIcon,
  schemaToFilterFields,
} from './SchemaRender';
import { BulkActionsMenu, FloatingSelectionBar } from './SelectionActionBar';
import type { ActiveFilters } from '@bbux/types';
import {
  clearFilterKey,
  getTextFilter,
  serializeFilters,
  setTextFilter,
} from '@bbux/types';
import type { TableSettings } from '@bbux/types';
import { isColumnVisible } from '@bbux/types';
import type { EntityListOutletContext, RowActionsConfig } from './types/types';

// The schema-driven table. Given a ListSchema from /v1/bootstrap,
// renders columns + rows + wires filter state through to the
// toolbar. Applies table settings (visible columns, ordering,
// grouping, sub-grouping) locally — ordering runs on the loaded
// page only; backend-driven ordering lands when we have a cross-page
// sort story.

const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const NO_GROUP_LABEL = '—';
const MIN_COL_WIDTH = 100;
const DEFAULT_COL_WIDTH = 180;
// Hard cap — a user can't drag past this, and the first-drag
// snapshot clamps to it even when a column's natural auto-layout
// width is wider. Prevents one verbose cell (e.g. a long quote
// description) from consuming the whole viewport.
const MAX_COL_WIDTH = 600;
// Fixed non-resizable gutters at either end of each row:
// the row-select checkbox (leading) and the row actions
// trigger (trailing). Never passed to tanstack so they can't
// be dragged; added into the table's total width calc so the
// fixed-layout table sums correctly.
const CHECKBOX_COL_WIDTH = 40;
const ACTIONS_COL_WIDTH = 40;

// TanStack Table requires a data array. We only lean on it for
// column sizing state + resize handles, not row rendering, so an
// empty frozen array is enough and avoids per-render identity churn.
const EMPTY_ROWS: ReadonlyArray<unknown> = Object.freeze([]);

// Sticky-row offsets. Heads and group headers carry their own
// bottom border on the cells (border-box inside h-10 / h-9), so the
// math is clean: thead 40px, depth-0 group 36px, depth-1 group 36px.
const STICKY_TOP_GROUP_0 = 40;
const STICKY_TOP_GROUP_1 = 76;

// Row virtualization kicks in when the loaded row count crosses
// this threshold AND no grouping is active. Grouped views render
// far fewer DOM nodes (group headers + collapsed rows) so the
// non-virtual recursive renderer is cheaper there. The flat-list
// case is what gets slow once you scroll past a few hundred rows.
const VIRT_THRESHOLD = 200;
const ESTIMATED_ROW_HEIGHT = 36;
// Render this many extra rows above + below the viewport so a
// fast scroll doesn't tear. Trade-off: bigger overscan = more
// DOM, less perceived lag on flick-scrolls. 12 rows ≈ ~432px,
// roughly half a viewport on a typical laptop — comfortable.
const VIRT_OVERSCAN = 12;

// Boundary divider on the inner edge of the pinned columns once the
// user scrolls horizontally. A solid 1px line (via inset box-shadow)
// instead of a soft shadow — simpler, theme-aware (uses
// --border-strong), and continuous across rows without any of the
// alpha-fade / dark-mode issues a blurred shadow runs into. Inset
// means the line paints inside the cell border, so the line lives in
// the rightmost / leftmost pixel of the sticky cell itself.
//
// Tailwind shadow-[…] utilities each set --tw-shadow, so they don't
// stack — header cells need to compose the inset bottom-border WITH
// the divider in a single inline value, which is what
// stickyHeaderBoxShadow does. Body cells only apply one inset shadow
// at a time so the simple Tailwind utility is fine there.
const PIN_SHADOW_LEFT = 'shadow-[inset_-1px_0_0_var(--border-strong)]';
const PIN_SHADOW_RIGHT = 'shadow-[inset_1px_0_0_var(--border-strong)]';
const HEADER_BOTTOM_BORDER_LAYER = 'inset 0 -1px 0 var(--border)';
const PIN_LEFT_LAYER = 'inset -1px 0 0 var(--border-strong)';
const PIN_RIGHT_LAYER = 'inset 1px 0 0 var(--border-strong)';

function stickyHeaderBoxShadow(showLeftPin: boolean, showRightPin: boolean): string {
  const layers = [HEADER_BOTTOM_BORDER_LAYER];
  if (showLeftPin) layers.push(PIN_LEFT_LAYER);
  if (showRightPin) layers.push(PIN_RIGHT_LAYER);
  return layers.join(', ');
}

// The per-row "⋯" menu is built by EntitySchemaTable (which knows the row type
// T, rowKey, and detailPathBase) and consumed by each Row through this context,
// so the action config never has to thread through the virtualized/grouped row
// layers. null → no actions menu for this list.
const RenderRowActionsContext = createContext<((row: unknown) => ReactNode) | null>(null);

// Cell rendering config (per-column render overrides + injected cell types),
// provided by EntitySchemaTable and consumed by Row via context so it doesn't
// prop-drill through GroupedRows.
const CellRenderContext = createContext<{
  cellOverrides?: Record<string, (row: unknown) => ReactNode>;
  cellRegistry?: Record<string, ComponentType<CellProps>>;
}>({});

export interface EntitySchemaTableProps<T> {
  title: string;
  schema: ListSchema;
  rows: ReadonlyArray<T>;
  total?: number;
  newLabel: string;
  isLoading: boolean;
  error: unknown;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  rowKey: (row: T) => string | undefined;
  // Optional: when provided, the table surfaces a "mirror data is
  // stale" banner if the most recent sync across loaded rows is
  // older than STALE_THRESHOLD_MS. Mirror-backed entities pass it;
  // domain-owned entities (future Quotes / Jobs) leave it off.
  lastSyncedAt?: (row: T) => string | undefined;
  activeFilters: ActiveFilters;
  onFiltersChange: (next: ActiveFilters) => void;
  // Filters locked by the tab preset — shown as non-clearable chips and
  // excluded from the filter menu. Merged into the API query alongside
  // activeFilters; the list component owns that merge.
  lockedFilters?: ActiveFilters;
  tableSettings: TableSettings;
  onTableSettingsChange: (next: TableSettings) => void;
  // Infinite-scroll hooks. When onLoadMore is provided, the table
  // observes a sentinel row near the end of the scroll container
  // and calls it when visible. hasMore short-circuits the observer
  // once the dataset is fully loaded; isFetchingMore shows a
  // spinner row instead of hiding the sentinel entirely so the
  // user sees that a fetch is in flight. isRefetching (vs
  // isLoading) fires when filters or sort change with previous
  // rows still on screen — drives a thin progress indicator
  // instead of tearing rows down to a skeleton.
  onLoadMore?: () => void;
  hasMore?: boolean;
  isFetchingMore?: boolean;
  isRefetching?: boolean;
  // When provided, the table wraps the pinned-left primary cell in
  // a react-router <Link> to `${detailPathBase}/${rowId}`. Lets
  // every list page link the row's identity column to its detail
  // page (e.g. Customers' name → /people/customers/{id}).
  detailPathBase?: string;
  // Chart support (bbux): forwarded straight into the toolbar state so the
  // chart panel can compute exact per-value counts via GraphQL.
  chartCount?: (where: Record<string, unknown>) => Promise<number>;
  chartBaseWhere?: Record<string, unknown>;
  chartDefinitionId?: string;
  // When set, the toolbar's New button is enabled and calls this.
  onNew?: () => void;
  // When set, each row gets a "⋯" actions menu (Copy ID / Edit / Set status /
  // Delete) built from this config. See RowActionsConfig.
  rowActions?: RowActionsConfig<T>;
  // Per-column render escape hatch (keyed by Column.key). When a column has an
  // entry, the table renders `override(row)` inside a cell instead of dispatching
  // to a schema cell type — for arbitrary typed cells (badges, avatars, action
  // buttons) that don't map to a Column.type. Used by the admin/cart tables.
  cellOverrides?: Record<string, (row: T) => ReactNode>;
  // Extra cell components merged over the built-in CELL_REGISTRY (consumer-
  // injected cell types like bbux's url / entity-type / media-tile).
  cellRegistry?: Record<string, ComponentType<CellProps>>;
  // Optional bridge to a global command menu: the table registers a handler
  // that opens the bulk-actions menu for the current selection (⌘K), and clears
  // it on deselect. Omit (tcms) — the floating bar's Actions button still works.
  registerBulkCommand?: (open: (() => void) | null) => void;
}

export function EntitySchemaTable<T>({
  title,
  schema,
  rows,
  total,
  newLabel,
  isLoading,
  error,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  rowKey,
  lastSyncedAt,
  activeFilters,
  onFiltersChange,
  lockedFilters,
  tableSettings,
  onTableSettingsChange,
  onLoadMore,
  hasMore,
  detailPathBase,
  isFetchingMore,
  isRefetching,
  chartCount,
  chartBaseWhere,
  chartDefinitionId,
  onNew,
  rowActions,
  cellOverrides,
  cellRegistry,
  registerBulkCommand,
}: EntitySchemaTableProps<T>) {
  const navigate = useNavigate();
  const { openModal } = useModals();
  // Optional command-menu bridge (bbux wires it; tcms omits it → no-op).
  const setContextualHandler = registerBulkCommand ?? (() => {});

  // The actions command menu (the bulk/row palette). Opened for the selected
  // rows (⌘K / the floating bar) or for a single row (its "⋯" trigger).
  // menuOpenRef stops a repeat trigger stacking a second panel. onClearAfter is
  // passed only for the selection flow (so it shows "Clear selection" and
  // clears after running); a single-row "⋯" passes none.
  const menuOpenRef = useRef(false);
  const openActionsMenu = useCallback(
    (rowsArg: T[], onClearAfter?: () => void) => {
      if (menuOpenRef.current || rowsArg.length === 0) return;
      menuOpenRef.current = true;
      openModal(
        ({ close }) => (
          <BulkActionsMenu
            rows={rowsArg}
            rowActions={rowActions}
            rowId={rowKey}
            editHref={(row) => {
              const id = rowKey(row);
              return detailPathBase && id ? `${detailPathBase}/${id}` : undefined;
            }}
            onNavigate={(path) => navigate(path)}
            onClear={onClearAfter}
            onClose={close}
          />
        ),
        {
          size: 'md',
          onClose: () => {
            menuOpenRef.current = false;
          },
        },
      );
    },
    [openModal, rowActions, rowKey, detailPathBase, navigate],
  );

  // The per-row "⋯" trigger: opens the actions menu scoped to that one row
  // (Copy ID / Edit / Set status / Add tag / Delete) — no dropdown.
  const renderRowActions = useMemo<((row: unknown) => ReactNode) | null>(() => {
    if (!rowActions) return null;
    return (r) => {
      const row = r as T;
      const id = rowKey(row);
      return (
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid={id ? `row-actions-${id}` : 'row-actions'}
          className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            openActionsMenu([row]);
          }}
        >
          <MoreHorizontal />
          <span className="sr-only">Row actions</span>
        </Button>
      );
    };
  }, [rowActions, rowKey, openActionsMenu]);

  const lockedKeys = useMemo(() => new Set(Object.keys(lockedFilters ?? {})), [lockedFilters]);
  const allFilterFields = useMemo(() => schemaToFilterFields(schema), [schema]);
  // User-adjustable fields: shown in the filter menu + as clearable chips.
  const filterFields = useMemo(
    () => allFilterFields.filter((f) => !lockedKeys.has(f.key)),
    [allFilterFields, lockedKeys],
  );
  // Locked fields: shown as non-clearable chips, excluded from the menu.
  const lockedFilterFields = useMemo(
    () => allFilterFields.filter((f) => lockedKeys.has(f.key)),
    [allFilterFields, lockedKeys],
  );

  // Effective filters = user filters merged with locked filters,
  // serialized for the chart's distinct endpoint. Locked wins on
  // collision, mirroring the API path's merge order.
  const effectiveFilters = useMemo(() => {
    const merged: ActiveFilters = { ...activeFilters, ...(lockedFilters ?? {}) };
    return serializeFilters(merged);
  }, [activeFilters, lockedFilters]);

  // Register toolbar state with the section shell that wraps this
  // table — when one is present. The same EntitySchemaTable is now
  // also embedded inside DetailPageShell (via RelatedEntityTable),
  // where there's no section shell providing the outlet context.
  // useOutletContext returns null in that case; we no-op the toolbar
  // wiring so the embedded use stays the same.
  const outletCtx = useOutletContext<EntityListOutletContext | null>();
  const setToolbar = outletCtx?.setToolbar;
  useEffect(() => {
    if (!setToolbar) return;
    setToolbar({
      title,
      total,
      newLabel,
      filterFields,
      lockedFilterFields,
      activeFilters,
      onFiltersChange,
      lockedFilters,
      schema,
      tableSettings,
      onTableSettingsChange,
      effectiveFilters,
      chartCount,
      chartBaseWhere,
      chartDefinitionId,
      onNew,
    });
    return () => setToolbar(null);
  }, [
    setToolbar,
    title,
    total,
    newLabel,
    filterFields,
    lockedFilterFields,
    activeFilters,
    onFiltersChange,
    lockedFilters,
    schema,
    tableSettings,
    onTableSettingsChange,
    effectiveFilters,
    chartCount,
    chartBaseWhere,
    chartDefinitionId,
    onNew,
  ]);

  const mostRecentSync = useMemo(() => {
    if (!lastSyncedAt || rows.length === 0) return null;
    return rows.reduce<Date | null>((latest, r) => {
      const ts = lastSyncedAt(r);
      if (!ts) return latest;
      const d = new Date(ts);
      if (!latest || d > latest) return d;
      return latest;
    }, null);
  }, [rows, lastSyncedAt]);

  const isStale =
    mostRecentSync != null && Date.now() - mostRecentSync.getTime() > STALE_THRESHOLD_MS;

  // Columns to render are filtered by the visibility setting. Column
  // order is preserved from the schema.
  const visibleColumns = useMemo(
    () => schema.columns.filter((c) => isColumnVisible(tableSettings, c.key)),
    [schema.columns, tableSettings],
  );

  // Pinned-left column — the entity's primary identifier, the cell
  // that becomes a detail-page link. Stays visible during horizontal
  // scroll so the user always sees what they're navigating to. Only
  // one is supported; if the schema declares multiple, the first
  // visible one wins. Honoured per-tick: hiding the pinned column
  // via the display-options popover removes it as a sticky anchor.
  const pinnedLeftKey = useMemo(
    () => visibleColumns.find((c) => c.pinned === 'left')?.key ?? null,
    [visibleColumns],
  );

  // Ordering is server-side. tableSettings.orderBy feeds the list
  // endpoint's order_by query param (via useEntityList); the rows
  // we receive are already in the requested order, so no local
  // sort step is needed. Page-local client sort used to live here
  // but it was wrong under infinite scroll — the backend's page
  // boundaries are what they are, and sorting just the loaded set
  // produced inconsistent orderings as more pages arrived.
  const orderedRows = rows;

  const groupsByField = useMemo(() => groupingLabels(schema.columns), [schema.columns]);

  // Resolve grouping filter keys ("position") to row-side data paths
  // ("edges.position.name") via the matching column label. Done here
  // rather than in the renderer so the path lookup happens once per
  // settings change, not per row.
  const groupByPath = useMemo(
    () => (tableSettings.groupBy ? groupingPath(schema, tableSettings.groupBy) : null),
    [schema, tableSettings.groupBy],
  );
  const subGroupByPath = useMemo(
    () => (tableSettings.subGroupBy ? groupingPath(schema, tableSettings.subGroupBy) : null),
    [schema, tableSettings.subGroupBy],
  );

  // +2 for the leading select checkbox column and trailing actions
  // column — group-header rows colspan across all of them.
  const columnSpan = visibleColumns.length + 2;

  // Row selection is local UI state; the loaded id set drives the
  // header checkbox's tri-state. Bulk actions will read this out
  // later; for now it just paints the checkboxes.
  // Selection state lives in one object so the three fields move
  // atomically. Splitting them across multiple useState hooks raced.
  //
  //   selected   — the set of currently selected row IDs (drives UI)
  //   anchorId   — last row clicked without shift; identifies that
  //                a "plain" click has happened. Reset on toggle-all.
  //   prevCursor — last row that participated in a shift-click (or
  //                the anchor itself if no shift-click yet). Each
  //                shift-click paints from prevCursor to the new
  //                click; see selectRow's brush rule.
  type SelectionState = {
    selected: ReadonlySet<string>;
    anchorId: string | null;
    prevCursor: string | null;
  };
  const [selection, setSelection] = useState<SelectionState>(() => ({
    selected: new Set<string>(),
    anchorId: null,
    prevCursor: null,
  }));
  const selectedIds = selection.selected;
  const loadedIdsArray = useMemo(() => {
    const out: string[] = [];
    for (const row of orderedRows) {
      const id = rowKey(row);
      if (id) out.push(id);
    }
    return out;
  }, [orderedRows, rowKey]);
  const loadedIds = useMemo(() => new Set(loadedIdsArray), [loadedIdsArray]);
  const headerChecked = useMemo<boolean | 'indeterminate'>(() => {
    if (loadedIds.size === 0) return false;
    let selectedInLoaded = 0;
    for (const id of loadedIds) if (selectedIds.has(id)) selectedInLoaded++;
    if (selectedInLoaded === 0) return false;
    if (selectedInLoaded === loadedIds.size) return true;
    return 'indeterminate';
  }, [loadedIds, selectedIds]);
  // selectRow handles a checkbox click with optional shift-key range
  // semantics. Without shift, it's a plain toggle that resets the
  // anchor + cursor to the clicked row.
  //
  // With shift held, it paints the range [prevCursor, click] like a
  // drag-brush. The brush direction is determined by the CURRENT
  // state of the click target — if the user shift-clicks a row that
  // is currently UNselected, the brush is "select", so the path
  // from prevCursor to click is added to the selection. If they
  // shift-click a row that IS currently selected, the brush is
  // "deselect" and the path is removed.
  //
  // This gives the natural "drag the boundary" feel: click 1,
  // shift-click 5 selects 1-5; shift-click 3 (which is currently
  // selected) removes rows 3-5; shift-click 7 (now unselected)
  // re-extends to 3-7; and so on. Direction-agnostic.
  const selectRow = useCallback(
    (id: string, mods: { shift?: boolean; meta?: boolean } = {}) => {
      const { shift = false, meta = false } = mods;
      setSelection((prev) => {
        const cursor = prev.prevCursor ?? prev.anchorId;
        if (meta && !shift) {
          // Cmd/Ctrl-click: discrete multi-select. Toggle the row
          // WITHOUT touching anchor or cursor, so the existing
          // shift-click pivot stays usable.
          const next = new Set(prev.selected);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { ...prev, selected: next };
        }
        if (!shift || !cursor || cursor === id) {
          // Plain toggle (or shift-click on the cursor itself, which
          // is just a single-row toggle).
          const next = new Set(prev.selected);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { selected: next, anchorId: id, prevCursor: id };
        }
        const fromIdx = loadedIdsArray.indexOf(cursor);
        const toIdx = loadedIdsArray.indexOf(id);
        if (fromIdx < 0 || toIdx < 0) {
          // Cursor or click target isn't loaded — fall back to a
          // plain toggle so the click isn't lost.
          const next = new Set(prev.selected);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { selected: next, anchorId: id, prevCursor: id };
        }
        const [lo, hi] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        // Brush direction = opposite of click row's current state.
        // If the click row is currently selected, the user wants
        // it (and the path back to the cursor) deselected.
        const brushOn = !prev.selected.has(id);
        const next = new Set(prev.selected);
        for (let i = lo; i <= hi; i++) {
          const rid = loadedIdsArray[i];
          if (brushOn) next.add(rid);
          else next.delete(rid);
        }
        // anchor stays — only the cursor advances to the click.
        return { ...prev, selected: next, prevCursor: id };
      });
    },
    [loadedIdsArray],
  );
  const toggleAll = useCallback(() => {
    setSelection((prev) => {
      // If every loaded id is already selected, clear them; else
      // add them all. Preserves selection of rows not currently
      // rendered (e.g. ones hidden by an in-flight filter change).
      let allSelected = true;
      for (const id of loadedIds) {
        if (!prev.selected.has(id)) {
          allSelected = false;
          break;
        }
      }
      const next = new Set(prev.selected);
      if (allSelected) {
        for (const id of loadedIds) next.delete(id);
      } else {
        for (const id of loadedIds) next.add(id);
      }
      // Reset the shift-click anchor on a select-all action — the
      // gesture is unrelated to row-level pivoting.
      return { selected: next, anchorId: null, prevCursor: null };
    });
  }, [loadedIds]);
  const clearSelection = useCallback(
    () => setSelection({ selected: new Set<string>(), anchorId: null, prevCursor: null }),
    [],
  );

  // The selected row objects (not just ids) so bulk actions can run over them.
  const selectedRows = useMemo(
    () =>
      orderedRows.filter((r) => {
        const id = rowKey(r);
        return id != null && selectedIds.has(id);
      }),
    [orderedRows, rowKey, selectedIds],
  );

  // Open the actions menu for the current selection (the floating bar's Actions
  // button), clearing the selection after a run.
  const openBulkMenu = useCallback(
    () => openActionsMenu(selectedRows, clearSelection),
    [openActionsMenu, selectedRows, clearSelection],
  );

  // Register the bulk opener as the contextual ⌘/Ctrl+K handler while rows are
  // selected, so ⌘K opens THIS menu rather than the global command palette.
  useEffect(() => {
    setContextualHandler(selectedIds.size > 0 ? openBulkMenu : null);
    return () => setContextualHandler(null);
  }, [selectedIds.size, openBulkMenu, setContextualHandler]);

  // Keyboard navigation: focusedIndex tracks which row the user is
  // pointing at via arrow keys / j/k. Independent of selection —
  // a row can be focused without being selected (Space toggles).
  // null = nothing focused yet; first arrow press jumps to row 0.
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  // Clear focus when the user clicks somewhere outside the table
  // body (sidebar, header, etc.). The keyboard cursor stays put on
  // clicks INSIDE the table — clicking a row is a deliberate
  // navigation gesture and we don't want to fight it.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      // closest('table') walks up to the nearest table ancestor; if
      // the click was inside ANY row of any table on the page we
      // leave focus alone. Toolbar / sidebar / page chrome clicks
      // get here with no table ancestor → clear.
      if (target.closest('table')) return;
      if (target.closest('[data-keep-table-focus]')) return;
      setFocusedIndex(null);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);
  // Reset focus when the loaded rows change underneath us (filter
  // change, sort change, etc.) so we don't end up pointing past
  // the new row count.
  useEffect(() => {
    if (focusedIndex !== null && focusedIndex >= loadedIdsArray.length) {
      setFocusedIndex(loadedIdsArray.length > 0 ? loadedIdsArray.length - 1 : null);
    }
  }, [focusedIndex, loadedIdsArray.length]);

  // Global keyboard handler. Bound to document so users can drive
  // the table without first clicking into it (Linear-style). Skipped
  // when focus is in an input/textarea/contenteditable so filter
  // search and similar fields work normally.
  useEffect(() => {
    function isEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      if (loadedIdsArray.length === 0) return;

      // Cmd/Ctrl+A — select all loaded.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        toggleAll();
        return;
      }

      // First navigation key with no focus jumps to the top.
      if (focusedIndex === null) {
        if (
          e.key === 'ArrowDown' ||
          e.key === 'ArrowUp' ||
          e.key === 'j' ||
          e.key === 'k' ||
          e.key === 'Home' ||
          e.key === 'End'
        ) {
          e.preventDefault();
          setFocusedIndex(0);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          setFocusedIndex((i) => (i === null ? 0 : Math.min(i + 1, loadedIdsArray.length - 1)));
          break;
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          setFocusedIndex((i) => (i === null ? 0 : Math.max(i - 1, 0)));
          break;
        case 'PageDown':
          e.preventDefault();
          setFocusedIndex((i) => (i === null ? 0 : Math.min(i + 10, loadedIdsArray.length - 1)));
          break;
        case 'PageUp':
          e.preventDefault();
          setFocusedIndex((i) => (i === null ? 0 : Math.max(i - 10, 0)));
          break;
        case 'Home':
          e.preventDefault();
          setFocusedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusedIndex(loadedIdsArray.length - 1);
          break;
        case ' ':
        case 'x': {
          e.preventDefault();
          const id = loadedIdsArray[focusedIndex];
          if (id) {
            selectRow(id, {
              shift: e.shiftKey,
              meta: e.metaKey || e.ctrlKey,
            });
          }
          break;
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedIndex, loadedIdsArray, selectRow, toggleAll]);

  const focusedId = focusedIndex !== null ? loadedIdsArray[focusedIndex] : null;

  // Collapsed group keys. Each GroupedRows level builds a composite
  // key (filterKey:value, colon-joined with parents) so nested groups
  // collapse independently. Storing keys means new groups default to
  // expanded without seeding this on every render.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Infinite scroll + horizontal-scroll detection. We hold the
  // scroll-container element in *state* (via a callback ref) so
  // effects can list it as a dependency — refs don't trigger
  // re-renders, but state does, which is what we need to attach
  // scroll listeners exactly when the table mounts.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    setContainerEl(el);
  }, []);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!onLoadMore || !hasMore || isFetchingMore || !containerEl) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { root: containerEl, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, isFetchingMore, containerEl]);

  // When filters or sort change, the outer query restarts with
  // offset 0 and the loaded rows reset to page 1. Scroll the
  // container back to the top so the user lands at the start of
  // the new result set, not mid-scroll through the previous one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeFilters / sort identity is the trigger — the effect body doesn't read its contents, it just resets scroll on change.
  useEffect(() => {
    containerEl?.scrollTo({ top: 0 });
  }, [activeFilters, tableSettings.orderBy, tableSettings.orderDirection]);

  // Row virtualization. Active only when rows are flat (no group)
  // AND the count is large enough to matter. Grouped views render
  // headers + collapsed rows, far fewer DOM nodes — virtualizing
  // them would require flattening header + row sequences and
  // managing sticky group headers inside the virtualizer, which
  // isn't worth the complexity for the typical group-view size.
  const shouldVirtualize =
    !tableSettings.groupBy && !tableSettings.subGroupBy && orderedRows.length >= VIRT_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: orderedRows.length,
    getScrollElement: () => containerEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: VIRT_OVERSCAN,
    // measureElement lets the virtualizer learn the actual rendered
    // height of each row after first render — handles content of
    // varying line heights (long descriptions, multi-line cells)
    // without us hardcoding an exact estimate.
    measureElement:
      typeof window !== 'undefined' && !navigator.userAgent.includes('jsdom')
        ? (el) => el.getBoundingClientRect().height
        : undefined,
    // Stable key per row so re-orders / list shrinks don't reuse
    // measurements from a different row.
    getItemKey: (index) => loadedIdsArray[index] ?? index,
  });

  // Scroll the focused row into view whenever focus moves. With
  // virtualization, the off-screen row may not exist in the DOM
  // yet — use the virtualizer's scrollToIndex. With non-virtual
  // rendering, fall back to data-row-id + scrollIntoView.
  useEffect(() => {
    if (focusedIndex === null) return;
    const id = loadedIdsArray[focusedIndex];
    if (!id) return;
    if (shouldVirtualize) {
      rowVirtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
      return;
    }
    // CSS.escape so UUIDs with hyphens / etc. work in the selector.
    const el = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, loadedIdsArray, shouldVirtualize, rowVirtualizer]);

  // Horizontal-scroll state. Drives the boundary shadow on the
  // rightmost left-pinned cell (visible only when the user has
  // scrolled right at all) and on the right-pinned actions cell
  // (visible while there's still off-screen content to the right).
  // Re-derives on scroll, on container resize, and on table
  // resize — column resizes change scrollWidth without firing a
  // scroll event.
  const [scrolledLeft, setScrolledLeft] = useState(false);
  const [scrolledRight, setScrolledRight] = useState(false);
  useEffect(() => {
    if (!containerEl) {
      setScrolledLeft(false);
      setScrolledRight(false);
      return;
    }
    const update = () => {
      const sl = containerEl.scrollLeft > 0;
      // -1 fudge for sub-pixel rounding (zoomed displays / fractional
      // scaling sometimes leave 0.5px of phantom scrollWidth).
      const sr = containerEl.scrollLeft + containerEl.clientWidth < containerEl.scrollWidth - 1;
      setScrolledLeft(sl);
      setScrolledRight(sr);
    };
    update();
    containerEl.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(containerEl);
    const table = tableDomRef.current;
    if (table) ro.observe(table);
    return () => {
      containerEl.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [containerEl]);

  // Keys of columns backed by a text filter. Drives the search
  // icon on header hover and the switch between label and input
  // rendering. Every column except enum / bool pickers is text-
  // searchable in the column-driven model.
  const textFilterKeys = useMemo(() => {
    const out = new Set<string>();
    for (const c of schema.columns) {
      if (c.kind !== 'enum' && c.kind !== 'bool') out.add(c.key);
    }
    return out;
  }, [schema.columns]);
  // Columns the user explicitly opened an input on (independent of
  // whether they've typed anything yet). A column is in search
  // mode if it's in this set OR already has an active value.
  const [openSearch, setOpenSearch] = useState<ReadonlySet<string>>(new Set());
  const openColumnSearch = useCallback((key: string) => {
    setOpenSearch((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  const closeColumnSearch = useCallback((key: string) => {
    setOpenSearch((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  // Per-column icon + colour, indexed so the recursive grouped
  // renderer can look them up without walking schema.columns each
  // time. Colour is resolved once into a Tailwind class. Falls back
  // to the CircleDot / neutral defaults when the column doesn't
  // declare its own visual identity.
  const groupVisuals = useMemo(() => {
    const out = new Map<string, { icon: string; colorClassName: string }>();
    for (const c of schema.columns) {
      out.set(c.key, {
        icon: c.icon ?? 'CircleDot',
        colorClassName: resolveFilterColor(c.color),
      });
    }
    return out;
  }, [schema.columns]);

  // Column resizing ───────────────────────────────────────────────
  // We lean on @tanstack/react-table purely for column-sizing state
  // and resize handles. The rest of the table (row rendering,
  // grouping, selection, sort, filters) stays hand-rolled because
  // the schema-driven layout doesn't fit TanStack's column-def
  // model cleanly. See CLAUDE.md for the rationale behind the
  // schema-first approach.
  const tableDomRef = useRef<HTMLTableElement | null>(null);

  // Minimal column defs — id matches the schema key, header is the
  // label, and the size hints seed tanstack's internal accounting.
  const columnDefs = useMemo<ColumnDef<T>[]>(
    () =>
      schema.columns.map((c) => ({
        id: c.key,
        header: c.label,
        minSize: MIN_COL_WIDTH,
        size: DEFAULT_COL_WIDTH,
        maxSize: MAX_COL_WIDTH,
      })),
    [schema.columns],
  );

  // Translate our visibility source-of-truth into the shape tanstack
  // expects. Visibility is still managed outside (display-options
  // popover) — tanstack is a passive observer here.
  const columnVisibility = useMemo<VisibilityState>(() => {
    const out: VisibilityState = {};
    for (const c of schema.columns) out[c.key] = isColumnVisible(tableSettings, c.key);
    return out;
  }, [schema.columns, tableSettings]);

  // Column sizing lives in local state during drag (fast, no parent
  // re-render per pixel) and commits back into tableSettings on
  // drop. External updates (e.g. "reset to defaults") flow in via
  // the sync effect immediately below.
  const [localSizing, setLocalSizing] = useState<ColumnSizingState>(tableSettings.columnWidths);
  useEffect(() => {
    setLocalSizing(tableSettings.columnWidths);
  }, [tableSettings.columnWidths]);

  const hasExplicitSizing = Object.keys(localSizing).length > 0;

  const rtTable = useReactTable<T>({
    data: EMPTY_ROWS as T[],
    columns: columnDefs,
    state: { columnSizing: localSizing, columnVisibility },
    onColumnSizingChange: setLocalSizing,
    // We roll our own resize logic (see onStartResize below). TanStack's
    // built-in resize subscribes to window.mousemove and writes
    // columnSizingInfo.deltaOffset on every frame — that's a state
    // update inside useReactTable, which re-renders this component
    // ~60×/sec during drag. `columnResizeMode: 'onEnd'` only defers
    // the column-width commit; it does NOT stop the per-mousemove
    // state churn. Disabling it entirely is the only way to keep the
    // parent idle while dragging.
    enableColumnResizing: false,
    defaultColumn: { minSize: MIN_COL_WIDTH, size: DEFAULT_COL_WIDTH, maxSize: MAX_COL_WIDTH },
    getCoreRowModel: getCoreRowModel(),
  });

  // Refs mirror the latest settings + handler so the commit effect
  // doesn't need them in its dep list (would churn per keystroke).
  const tableSettingsRef = useRef(tableSettings);
  const onTableSettingsChangeRef = useRef(onTableSettingsChange);
  useEffect(() => {
    tableSettingsRef.current = tableSettings;
    onTableSettingsChangeRef.current = onTableSettingsChange;
  });

  // Resize state. `resizingKey` flips on mousedown and off on mouseup
  // — that's it. No mousemove tracking on the parent: ResizeGuideLine
  // owns the cursor-following line via direct DOM writes (no React
  // state), and the new column width is computed once on mouseup
  // from `endX - startX`. Total parent re-renders per drag: 2.
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  // Snapshot of localSizing kept on a ref so onStartResize can read
  // the current width on mousedown without taking localSizing as a
  // dep (which would re-create the callback per width change).
  const localSizingRef = useRef(localSizing);
  useEffect(() => {
    localSizingRef.current = localSizing;
  });

  // Commit widths to the parent on drag end. resizingKey transitions
  // from a column id (during drag) to null (idle); that's our persist
  // signal.
  const prevResizingRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevResizingRef.current && !resizingKey) {
      onTableSettingsChangeRef.current({
        ...tableSettingsRef.current,
        columnWidths: { ...localSizing },
      });
    }
    prevResizingRef.current = resizingKey;
  }, [resizingKey, localSizing]);

  // Seed widths on first paint (and after any reset via the
  // display-options popover). The <Table> only renders once rows
  // have loaded — i.e. tableDomRef.current is null for the first
  // few renders while the skeleton is up — so we run on *every*
  // render and short-circuit once either (a) the ref is still null
  // or (b) widths are already seeded. useLayoutEffect runs after
  // DOM mutation but before paint, so there's no visual flash
  // between the unbounded auto-layout measurement and the clamped
  // fixed-layout render.
  useLayoutEffect(() => {
    if (hasExplicitSizing) return;
    const table = tableDomRef.current;
    if (!table) return;
    const ths = table.querySelectorAll<HTMLElement>('thead th[data-col-key]');
    if (ths.length === 0) return;
    const seed: ColumnSizingState = {};
    for (const th of ths) {
      const key = th.dataset.colKey;
      if (!key) continue;
      const measured = Math.round(th.getBoundingClientRect().width);
      seed[key] = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, measured));
    }
    if (Object.keys(seed).length > 0) setLocalSizing(seed);
  });

  const onStartResize = useCallback(
    (colKey: string) => (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const startWidth = localSizingRef.current[colKey] ?? DEFAULT_COL_WIDTH;
      setResizingKey(colKey);

      const finish = (clientX: number) => {
        const delta = clientX - startX;
        const newWidth = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, startWidth + delta));
        setLocalSizing((prev) => ({ ...prev, [colKey]: newWidth }));
        setResizingKey(null);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('touchend', onTouchEnd);
      };
      const onMouseUp = (ev: MouseEvent) => finish(ev.clientX);
      const onTouchEnd = (ev: TouchEvent) => finish(ev.changedTouches[0]?.clientX ?? startX);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('touchend', onTouchEnd);
    },
    [],
  );

  return (
    <CellRenderContext.Provider
      value={{
        cellOverrides: cellOverrides as
          | Record<string, (row: unknown) => ReactNode>
          | undefined,
        cellRegistry,
      }}
    >
    <RenderRowActionsContext.Provider value={renderRowActions}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-4 pt-1">
        {error ? (
          <Banner variant="danger" title={`Failed to load ${title.toLowerCase()}`}>
            {(error as Error).message}
          </Banner>
        ) : isStale ? (
          <Banner variant="warning" title="Mirror data is stale">
            The most recent sync was <RelativeTime value={mostRecentSync} />. Check the mirror
            service logs or trigger a re-sync.
          </Banner>
        ) : null}

        {(isLoading || isRefetching) && orderedRows.length === 0 ? (
          // cairn's loader: TableSkeleton renders the column headers + shimmer,
          // so headers never vanish. Extended from cairn's `isLoading` to also
          // cover `isRefetching` — with keepPreviousData a filter change keeps
          // previous rows, but when the previous result was itself empty (e.g.
          // clearing a filter that matched nothing) there are no rows to keep,
          // so the skeleton stands in instead of an empty-state flash.
          <TableSkeleton columns={visibleColumns} />
        ) : orderedRows.length === 0 && Object.keys(activeFilters).length === 0 ? (
          // Genuinely empty (no active filters) → cairn's full empty state.
          // When the list is empty because of an active filter, fall through to
          // the table so the column headers stay (deviation from cairn, which
          // drops them); the body shows a "no matches" note instead.
          <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Subtle top progress bar while refetching on
              filter/sort changes. Sits above the bordered scroll
              box so the inner content doesn't jump. */}
            {isRefetching ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden rounded-t-md"
              >
                <div className="table-progress-bar h-full w-1/3 bg-primary/70" />
              </div>
            ) : null}
            {/* Resize guide line. Mounted only while a column is being
            resized. Owns its own mousemove listener and updates the
            line's left via ref — so dragging doesn't trigger any
            parent re-render, even on tables with thousands of rows. */}
            {resizingKey && containerEl ? <ResizeGuideLine containerEl={containerEl} /> : null}
            <Table
              tableRef={tableDomRef}
              containerRef={containerRef}
              // [container-type:inline-size] lets descendants use cqi
              // units (see the Loading-more / End-of-list message rows
              // for the use-case).
              containerClassName="flex-1 min-h-0 min-w-0 overflow-auto rounded-md border border-border [container-type:inline-size]"
              style={
                hasExplicitSizing
                  ? {
                      tableLayout: 'fixed',
                      width: rtTable.getCenterTotalSize() + CHECKBOX_COL_WIDTH + ACTIONS_COL_WIDTH,
                    }
                  : undefined
              }
            >
              {/* Strip both shadcn default borders — TableHeader applies
              [&_tr]:border-b and TableRow applies border-b on every
              tr. Under border-collapse:collapse (Tailwind's table
              reset) a 1px row-border lives *between* thead and the
              first tbody tr, which the sticky math can't account
              for. We draw the thead separator as an inset
              box-shadow on each cell — zero layout impact — so the
              thead is exactly h-10 (40px) and the sticky group at
              top-40 lands flush. */}
              <TableHeader className="[&_tr]:border-b-0">
                <TableRow className="group/thead border-b-0">
                  <TableHead
                    style={{
                      width: CHECKBOX_COL_WIDTH,
                      minWidth: CHECKBOX_COL_WIDTH,
                      left: 0,
                      // Header rows compose two layered shadows: the
                      // 1px inset bottom-border under the thead, plus a
                      // soft 6px right-edge shadow when this is the
                      // rightmost left-pinned cell and the user has
                      // scrolled. Tailwind's shadow utilities don't
                      // stack — they each set --tw-shadow — so we
                      // build the concatenated value inline.
                      boxShadow: stickyHeaderBoxShadow(!pinnedLeftKey && scrolledLeft, false),
                    }}
                    className="sticky top-0 z-40 h-10 bg-background px-0"
                    aria-label="Select all rows"
                  >
                    <div
                      className={cn(
                        'flex items-center justify-center transition-opacity',
                        // Visible when something is selected (so the
                        // user can see the tri-state and clear-all) or
                        // when hovering anywhere on the header row;
                        // otherwise fades out so idle chrome stays
                        // minimal.
                        headerChecked !== false
                          ? 'opacity-100'
                          : 'opacity-0 group-hover/thead:opacity-100 focus-within:opacity-100',
                      )}
                    >
                      <Checkbox
                        checked={headerChecked}
                        onCheckedChange={toggleAll}
                        aria-label="Select all rows"
                      />
                    </div>
                  </TableHead>
                  {visibleColumns.map((c) => {
                    // The backend schema declares which columns wire
                    // click-to-sort. Same source of truth as the
                    // order_by allowlist on the server, so clicking a
                    // `sortable: true` column never produces a 400 and
                    // non-sortable columns render as static labels.
                    const sortable = c.sortable === true;
                    const active = tableSettings.orderBy === c.key;
                    const asc = tableSettings.orderDirection === 'asc';
                    const textFilterable = textFilterKeys.has(c.key);
                    const textValue = getTextFilter(activeFilters, c.key);
                    const searching = openSearch.has(c.key) || textValue !== '';
                    const colWidth = localSizing[c.key] ?? DEFAULT_COL_WIDTH;
                    const isColResizing = resizingKey === c.key;
                    const isPinnedLeft = c.key === pinnedLeftKey;
                    const headStyle: React.CSSProperties = hasExplicitSizing
                      ? { width: colWidth }
                      : {};
                    if (isPinnedLeft) {
                      headStyle.left = CHECKBOX_COL_WIDTH;
                      headStyle.boxShadow = stickyHeaderBoxShadow(scrolledLeft, false);
                    } else {
                      headStyle.boxShadow = stickyHeaderBoxShadow(false, false);
                    }
                    return (
                      <TableHead
                        key={c.key}
                        data-col-key={c.key}
                        style={headStyle}
                        className={cn(
                          'group/col sticky top-0 h-10 bg-background p-0',
                          isPinnedLeft ? 'z-40' : 'z-30',
                        )}
                      >
                        {/* The <th> is sticky, so it can't also be
                          relative — this wrapper is the containing
                          block for the absolute resize handle and
                          gives the sort-button flex row a concrete
                          height to fill. */}
                        <div className="relative h-full w-full">
                          {textFilterable && searching ? (
                            <HeaderSearchInput
                              label={c.label}
                              value={textValue}
                              onCommit={(next) =>
                                onFiltersChange(setTextFilter(activeFilters, c.key, next))
                              }
                              onClose={() => {
                                onFiltersChange(clearFilterKey(activeFilters, c.key));
                                closeColumnSearch(c.key);
                              }}
                            />
                          ) : sortable ? (
                            // The sort button spans the entire cell so any
                            // click inside the header area cycles the sort.
                            // The search icon is absolutely positioned on
                            // top of it — since buttons can't nest, it's a
                            // sibling that visually overlaps; clicks on
                            // the icon get preventDefault + stopPropagation
                            // so the underlying sort button doesn't also
                            // receive them.
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  // Three-state cycle: off → asc → desc → off.
                                  // Clicking a column that's not active jumps
                                  // straight to asc; clicking the active
                                  // column advances through the cycle.
                                  if (!active) {
                                    onTableSettingsChange({
                                      ...tableSettings,
                                      orderBy: c.key,
                                      orderDirection: 'asc',
                                    });
                                  } else if (asc) {
                                    onTableSettingsChange({
                                      ...tableSettings,
                                      orderBy: c.key,
                                      orderDirection: 'desc',
                                    });
                                  } else {
                                    onTableSettingsChange({
                                      ...tableSettings,
                                      orderBy: null,
                                      orderDirection: 'desc',
                                    });
                                  }
                                }}
                                className={cn(
                                  // pr-7 reserves space at the right edge for
                                  // the overlaid search icon when the column
                                  // is text-filterable; pr-2 keeps plain
                                  // sort-only headers flush.
                                  'flex h-full w-full min-w-0 items-center gap-1 pl-2 text-left transition-colors',
                                  textFilterable ? 'pr-7' : 'pr-2',
                                  'hover:bg-muted/50',
                                  active && 'text-text',
                                )}
                              >
                                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                                {active ? (
                                  asc ? (
                                    <ArrowUp className="size-3 shrink-0" />
                                  ) : (
                                    <ArrowDown className="size-3 shrink-0" />
                                  )
                                ) : null}
                              </button>
                              {textFilterable ? (
                                <button
                                  type="button"
                                  aria-label={`Search ${c.label}`}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openColumnSearch(c.key);
                                  }}
                                  className={cn(
                                    '-translate-y-1/2 absolute top-1/2 right-2 z-20 inline-flex size-5 shrink-0 items-center justify-center rounded text-text-muted transition-opacity',
                                    'opacity-0 hover:bg-surface-3 hover:text-text group-hover/col:opacity-100 focus-within:opacity-100',
                                  )}
                                >
                                  <Search className="size-3.5" />
                                </button>
                              ) : null}
                            </>
                          ) : (
                            <div className="flex h-full w-full items-center px-2">
                              <span className="truncate">{c.label}</span>
                            </div>
                          )}
                          {/* Resize handle. 6px hit target, visible as
                            a border-coloured bar on column hover,
                            primary while actively dragging. Our own
                            drag handler (see onStartResize) attaches a
                            mouseup-only listener — no mousemove
                            subscription means no parent re-renders
                            during drag; the cursor-tracking line is
                            owned by ResizeGuideLine. */}
                          <div
                            onMouseDown={onStartResize(c.key)}
                            onTouchStart={onStartResize(c.key)}
                            className={cn(
                              'absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none transition-colors',
                              'group-hover/col:bg-border/70 hover:bg-primary/60',
                              isColResizing && 'bg-primary',
                            )}
                            aria-hidden
                          />
                        </div>
                      </TableHead>
                    );
                  })}
                  <TableHead
                    style={{
                      width: ACTIONS_COL_WIDTH,
                      minWidth: ACTIONS_COL_WIDTH,
                      right: 0,
                      boxShadow: stickyHeaderBoxShadow(false, scrolledRight),
                    }}
                    className="sticky top-0 z-40 h-10 bg-background"
                    aria-label="Actions"
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderedRows.length === 0 ? (
                  // Reached only in the settled filtered-empty case (load /
                  // refetch show the skeleton above; the unfiltered-empty case
                  // shows the empty state). Headers stay; body explains why.
                  <tr data-slot="no-matches">
                    <td colSpan={columnSpan} className="p-0">
                      <div className="sticky left-0 w-[100cqi]">
                        <EmptyState
                          icon={emptyIcon}
                          title={`No ${title.toLowerCase()} match your filters`}
                          description="Try adjusting or clearing your filters to see more."
                          action={
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onFiltersChange({})}
                            >
                              Clear filters
                            </Button>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ) : shouldVirtualize ? (
                  <VirtualizedRows
                    rows={orderedRows}
                    columns={visibleColumns}
                    columnSpan={columnSpan}
                    rowKey={rowKey}
                    selectedIds={selectedIds}
                    onSelectRow={selectRow}
                    focusedId={focusedId}
                    detailPathBase={detailPathBase}
                    pinnedLeftKey={pinnedLeftKey}
                    scrolledLeft={scrolledLeft}
                    scrolledRight={scrolledRight}
                    virtualizer={rowVirtualizer}
                  />
                ) : (
                  <GroupedRows
                    rows={orderedRows}
                    columns={visibleColumns}
                    columnSpan={columnSpan}
                    groupBy={tableSettings.groupBy}
                    groupByPath={groupByPath}
                    subGroupBy={tableSettings.subGroupBy}
                    subGroupByPath={subGroupByPath}
                    groupsByField={groupsByField}
                    groupVisuals={groupVisuals}
                    collapsed={collapsedGroups}
                    onToggle={toggleGroup}
                    rowKey={rowKey}
                    selectedIds={selectedIds}
                    onSelectRow={selectRow}
                    focusedId={focusedId}
                    detailPathBase={detailPathBase}
                    pinnedLeftKey={pinnedLeftKey}
                    scrolledLeft={scrolledLeft}
                    scrolledRight={scrolledRight}
                  />
                )}
                {onLoadMore && hasMore ? (
                  <tr ref={sentinelRef} data-slot="sentinel">
                    <td
                      colSpan={columnSpan}
                      className="h-8 p-0 shadow-[inset_0_1px_0_var(--border)]"
                    >
                      {isFetchingMore ? (
                        // sticky left-0 + w-[100cqi] = pinned to the
                        // viewport's left edge with width = scroll
                        // container's inline size (set as a CSS query
                        // container below), so the message stays
                        // centred to the visible area instead of the
                        // full table width when columns trigger
                        // horizontal scroll.
                        <div className="sticky left-0 flex w-[100cqi] items-center justify-center gap-2 py-2 text-xs text-text-muted">
                          <Loader2 className="size-3.5 animate-spin" />
                          Loading more…
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : onLoadMore && !hasMore && rows.length > 0 ? (
                  <tr data-slot="end-of-list">
                    <td colSpan={columnSpan} className="p-0 shadow-[inset_0_1px_0_var(--border)]">
                      <div className="sticky left-0 inline-flex w-[100cqi] items-center justify-center py-2 text-xs text-text-muted">
                        End of list
                        <Dot className="size-4 text-text-subtle" aria-hidden />
                        {new Intl.NumberFormat('en-AU').format(rows.length)} {title.toLowerCase()}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </TableBody>
            </Table>
            {selectedIds.size > 0 ? (
              <FloatingSelectionBar
                count={selectedIds.size}
                onOpen={openBulkMenu}
                onClear={clearSelection}
              />
            ) : null}
          </div>
        )}
      </div>
    </RenderRowActionsContext.Provider>
    </CellRenderContext.Provider>
  );
}

// Virtualized renderer for the flat (un-grouped) case. Only the
// rows whose virtual indexes are within the viewport (+ overscan)
// are rendered; the rest is replaced by two padding rows that
// account for the height of the off-screen content. The padding
// rows have colSpan so the table layout doesn't collapse.
//
// Each visible row uses the virtualizer's measureElement ref so
// the virtualizer can refine its size estimate after layout.
// data-index is the virtual index — required for measureElement
// + scrollToIndex to find the element.
function VirtualizedRows<T>({
  rows,
  columns,
  columnSpan,
  rowKey,
  selectedIds,
  onSelectRow,
  focusedId,
  detailPathBase,
  pinnedLeftKey,
  scrolledLeft,
  scrolledRight,
  virtualizer,
}: {
  rows: ReadonlyArray<T>;
  columns: ReadonlyArray<Column>;
  columnSpan: number;
  rowKey: (row: T) => string | undefined;
  selectedIds: ReadonlySet<string>;
  onSelectRow: (id: string, mods: { shift?: boolean; meta?: boolean }) => void;
  focusedId: string | null;
  detailPathBase: string | undefined;
  pinnedLeftKey: string | null;
  scrolledLeft: boolean;
  scrolledRight: boolean;
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
}) {
  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = items.length > 0 ? items[0].start : 0;
  const paddingBottom = items.length > 0 ? totalSize - items[items.length - 1].end : 0;

  return (
    <>
      {paddingTop > 0 ? (
        <tr aria-hidden style={{ height: paddingTop }}>
          <td colSpan={columnSpan} className="p-0" />
        </tr>
      ) : null}
      {items.map((item) => {
        const row = rows[item.index];
        if (row === undefined) return null;
        const id = rowKey(row);
        return (
          <Row
            key={id ?? `row-${item.index}`}
            rowId={id}
            row={row}
            columns={columns}
            depth={0}
            selected={id ? selectedIds.has(id) : false}
            focused={!!id && focusedId === id}
            detailHref={detailPathBase && id ? `${detailPathBase}/${id}` : undefined}
            onSelectRow={id ? (mods) => onSelectRow(id, mods) : undefined}
            pinnedLeftKey={pinnedLeftKey}
            scrolledLeft={scrolledLeft}
            scrolledRight={scrolledRight}
            virtualIndex={item.index}
            measureRef={virtualizer.measureElement}
          />
        );
      })}
      {paddingBottom > 0 ? (
        <tr aria-hidden style={{ height: paddingBottom }}>
          <td colSpan={columnSpan} className="p-0" />
        </tr>
      ) : null}
    </>
  );
}

// Recursive renderer. When groupBy is null, falls through to flat
// <Row> rendering; otherwise emits group header rows, then recurses
// with groupBy = subGroupBy (or null) for the second level. groupBy
// carries the filter key (used as the labelMap index); groupByPath
// is the resolved row-side data path (used to bucket rows).
function GroupedRows<T>({
  rows,
  columns,
  columnSpan,
  groupBy,
  groupByPath,
  subGroupBy,
  subGroupByPath,
  groupsByField,
  groupVisuals,
  collapsed,
  onToggle,
  rowKey,
  selectedIds,
  onSelectRow,
  focusedId,
  detailPathBase,
  pinnedLeftKey,
  scrolledLeft,
  scrolledRight,
  keyPrefix = '',
  depth = 0,
}: {
  rows: ReadonlyArray<T>;
  columns: ReadonlyArray<Column>;
  columnSpan: number;
  groupBy: string | null;
  groupByPath: string | null;
  subGroupBy: string | null;
  subGroupByPath: string | null;
  groupsByField: Map<string, Map<string, string>>;
  groupVisuals: Map<string, { icon: string; colorClassName: string }>;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  rowKey: (row: T) => string | undefined;
  selectedIds: ReadonlySet<string>;
  onSelectRow: (id: string, mods: { shift?: boolean; meta?: boolean }) => void;
  focusedId: string | null;
  detailPathBase: string | undefined;
  pinnedLeftKey: string | null;
  scrolledLeft: boolean;
  scrolledRight: boolean;
  keyPrefix?: string;
  depth?: number;
}) {
  if (!groupBy || !groupByPath) {
    return (
      <>
        {rows.map((row, i) => {
          const id = rowKey(row);
          return (
            <Row
              key={id ?? `row-${i}`}
              rowId={id}
              row={row}
              columns={columns}
              depth={depth}
              selected={id ? selectedIds.has(id) : false}
              focused={!!id && focusedId === id}
              detailHref={detailPathBase && id ? `${detailPathBase}/${id}` : undefined}
              onSelectRow={id ? (mods) => onSelectRow(id, mods) : undefined}
              pinnedLeftKey={pinnedLeftKey}
              scrolledLeft={scrolledLeft}
              scrolledRight={scrolledRight}
            />
          );
        })}
      </>
    );
  }

  const groups = buildGroups(rows, groupByPath);
  const labelMap = groupsByField.get(groupBy);
  const visual = groupVisuals.get(groupBy);

  return (
    <>
      {groups.map(([value, groupRows]) => {
        const display = labelMap?.get(value) ?? value ?? NO_GROUP_LABEL;
        const groupKey = `${keyPrefix}${groupBy}:${value}`;
        const isCollapsed = collapsed.has(groupKey);
        return (
          <GroupFragment
            key={groupKey}
            depth={depth}
            columnSpan={columnSpan}
            iconName={visual?.icon}
            iconColorClass={visual?.colorClassName ?? 'text-text-muted'}
            display={display === '' ? NO_GROUP_LABEL : display}
            count={groupRows.length}
            isCollapsed={isCollapsed}
            onToggle={() => onToggle(groupKey)}
          >
            {!isCollapsed ? (
              <GroupedRows
                rows={groupRows}
                columns={columns}
                columnSpan={columnSpan}
                groupBy={subGroupBy}
                groupByPath={subGroupByPath}
                subGroupBy={null}
                subGroupByPath={null}
                groupsByField={groupsByField}
                groupVisuals={groupVisuals}
                collapsed={collapsed}
                onToggle={onToggle}
                rowKey={rowKey}
                selectedIds={selectedIds}
                onSelectRow={onSelectRow}
                focusedId={focusedId}
                detailPathBase={detailPathBase}
                pinnedLeftKey={pinnedLeftKey}
                scrolledLeft={scrolledLeft}
                scrolledRight={scrolledRight}
                keyPrefix={`${groupKey}|`}
                depth={depth + 1}
              />
            ) : null}
          </GroupFragment>
        );
      })}
    </>
  );
}

// Linear-style header row: chevron (rotates when open), filter icon,
// label, count, extending rule, trailing +. Sticky at a depth-aware
// top offset so nested headers stack under the thead as the user
// scrolls through a group.
function GroupFragment({
  depth,
  columnSpan,
  iconName,
  iconColorClass,
  display,
  count,
  isCollapsed,
  onToggle,
  children,
}: {
  depth: number;
  columnSpan: number;
  iconName: string | undefined;
  iconColorClass: string;
  display: string;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Icon = iconName ? resolveIcon(iconName) : null;
  const stickyTop =
    depth === 0 ? STICKY_TOP_GROUP_0 : depth === 1 ? STICKY_TOP_GROUP_1 : STICKY_TOP_GROUP_1;
  // Depth 0 = stronger surface tint; depth 1 softer and indented —
  // clearly subordinate. Icon colour comes from the filter's Color
  // token, so each filter's visual identity reads consistently
  // wherever it surfaces (menu, chips, headers).
  const isTopLevel = depth === 0;
  return (
    <>
      <tr data-slot="group-header">
        <td
          colSpan={columnSpan}
          className={cn(
            'sticky h-9 p-0',
            // z-30/z-20 keeps group headers above body sticky cells
            // (z-10) during vertical scroll. Header thead corners
            // (z-40) still win the topmost overlap.
            isTopLevel
              ? 'z-30 bg-surface-2 shadow-[inset_0_-1px_0_var(--border)]'
              : 'z-20 bg-surface-1',
          )}
          style={{ top: stickyTop }}
        >
          {/*
                      sticky left-0 + w-[100cqi] mirrors the Load More /
                      End of List rows: the wrapper sticks to the
                      viewport's left edge and matches the scroll
                      container's inline size (the parent declares
                      container-type: inline-size). Without this, the
                      chevron + label disappear off-screen on horizontal
                      scroll and the trailing + button is unreachable
                      without scrolling all the way to the right.
                    */}
          <div
            className={cn(
              'sticky left-0 flex w-[100cqi] items-center gap-2 px-2 py-1.5',
              !isTopLevel && 'pl-6',
            )}
          >
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                'inline-flex size-5 items-center justify-center rounded transition-colors',
                'text-text-muted hover:bg-surface-3 hover:text-text',
              )}
              aria-label={isCollapsed ? 'Expand group' : 'Collapse group'}
              aria-expanded={!isCollapsed}
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform', !isCollapsed && 'rotate-90')}
              />
            </button>
            {Icon ? <Icon className={cn('size-3.5 shrink-0', iconColorClass)} /> : null}
            <span
              className={cn(
                'truncate text-sm',
                isTopLevel ? 'font-semibold text-text' : 'font-medium text-text',
              )}
            >
              {display}
            </span>
            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-xs tabular-nums text-text-muted">
              {count}
            </span>
            <div className="ml-1 h-px flex-1 bg-border" />
            <button
              type="button"
              disabled
              title="New — Phase 1 writes back to Simpro"
              className="inline-flex size-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
              aria-label="New in group"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

function Row<T>({
  rowId,
  row,
  columns,
  depth,
  selected,
  focused,
  detailHref,
  onSelectRow,
  pinnedLeftKey,
  scrolledLeft,
  scrolledRight,
  virtualIndex,
  measureRef,
}: {
  // Stable id used for keyboard-nav scroll-into-view. Stamped onto
  // the <tr> as data-row-id so the parent can find the element.
  rowId: string | undefined;
  row: T;
  columns: ReadonlyArray<Column>;
  depth: number;
  selected: boolean;
  // Whether keyboard focus is currently on this row. Drives a
  // focus ring distinct from selected and hover.
  focused: boolean;
  // When set, the row's pinned-left primary cell renders as a
  // <Link> to this URL — the row's detail page.
  detailHref: string | undefined;
  // Called on checkbox click / keyboard activation. `shift` and
  // `meta` mirror the modifier keys so the parent can pick between
  // plain toggle, shift-range, and cmd-discrete-toggle.
  onSelectRow: ((mods: { shift?: boolean; meta?: boolean }) => void) | undefined;
  pinnedLeftKey: string | null;
  scrolledLeft: boolean;
  scrolledRight: boolean;
  // Virtualization wiring. Both undefined for non-virtualized rows;
  // both set when this Row is rendered inside VirtualizedRows so
  // the virtualizer can measure actual height per-row and find
  // elements by virtual index when scrolling-to-row.
  virtualIndex?: number;
  measureRef?: (node: Element | null) => void;
}) {
  // The list's per-row actions menu (Copy ID / Edit / Set status / Delete),
  // provided by EntitySchemaTable. null when the list wired no rowActions.
  const renderRowActions = useContext(RenderRowActionsContext);
  // Per-column render overrides + injected cell types (see CellRenderContext).
  const { cellOverrides, cellRegistry } = useContext(CellRenderContext);

  // Sticky cells need a fully OPAQUE background so non-sticky
  // content can't bleed through during horizontal scroll. The row's
  // own paints have to be opaque too (otherwise content scrolling
  // past the sticky cell shows through the row's translucent
  // overlay). Both the row primitive and the cells reference the
  // same --row-bg-* CSS vars (defined per theme in index.css), so
  // sticky cells and non-sticky cells match exactly.
  //
  // Three states stack: selected > focused > default. Selected
  // wins because the user's deliberate selection is the strongest
  // signal; focused is just "where the keyboard cursor is".
  const stickyBg = selected
    ? '!bg-(--row-bg-selected) group-hover:!bg-(--row-bg-selected-hover)'
    : focused
      ? '!bg-(--row-bg-focused) group-hover:!bg-(--row-bg-focused-hover)'
      : 'bg-background group-hover:bg-(--row-bg-hover)';

  // Boundary shadow on the rightmost left-pinned cell (checkbox if
  // no pinned col, otherwise the pinned col) and on the right-pinned
  // actions cell. When focused, the leading sticky cell ALSO carries
  // a 3px primary left-edge accent — the keyboard cursor indicator.
  // It paints inside the sticky cell so it survives every horizontal
  // scroll position (unlike a row-level inset shadow, which sticky
  // cell backgrounds cover).
  const FOCUS_ACCENT_LEFT = 'shadow-[inset_3px_0_0_var(--row-focused-accent)]';
  const checkboxShadow = focused
    ? FOCUS_ACCENT_LEFT
    : !pinnedLeftKey && scrolledLeft
      ? PIN_SHADOW_LEFT
      : null;
  const pinnedShadow = pinnedLeftKey && scrolledLeft ? PIN_SHADOW_LEFT : null;
  const actionsShadow = scrolledRight ? PIN_SHADOW_RIGHT : null;

  return (
    <TableRow
      data-row-id={rowId}
      data-testid="entity-row"
      data-index={virtualIndex}
      ref={measureRef}
      className={cn(
        'group relative',
        // Selected rows paint with the OPAQUE --row-bg-selected
        // vars (defined per theme in index.css). Sticky cells
        // reference the same vars so the row and the pinned
        // columns stay in lockstep — and opaque means non-pinned
        // content can't bleed through the sticky cells during
        // horizontal scroll. The ! overrides TableRow's
        // hover:bg-muted/50 cascade. Deliberately NOT setting
        // data-state="selected" because TableRow's built-in
        // data-[state=selected]:bg-muted rule would hit at idle
        // and paint the row grey instead of primary-tinted.
        selected && '!bg-(--row-bg-selected) hover:!bg-(--row-bg-selected-hover)',
        // Keyboard-focus row tint. Background is shared via
        // --row-bg-focused so sticky cells stay in lockstep —
        // an inset ring on the row would be covered by sticky
        // cell backgrounds. The actual "cursor" indicator is
        // the left-edge accent inside the leading sticky cell
        // (FOCUS_ACCENT_LEFT below).
        focused && !selected && '!bg-(--row-bg-focused) hover:!bg-(--row-bg-focused-hover)',
      )}
    >
      <td
        style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH, left: 0 }}
        className={cn('sticky z-10 p-1 align-middle', stickyBg, checkboxShadow)}
      >
        <div
          className={cn(
            'flex items-center justify-center transition-opacity',
            // Hidden chrome until this row is hovered or selected —
            // matches Linear's list density, keeps the "at-rest"
            // view focused on data. focus-within keeps keyboard
            // users from losing the checkbox when tabbing in.
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          )}
          // Capture the click BEFORE the Checkbox sees it so we can
          // read e.shiftKey / metaKey for range and discrete-toggle
          // selection. preventDefault suppresses the native toggle;
          // we drive the new state ourselves through onSelectRow.
          onClickCapture={(e) => {
            if (!onSelectRow) return;
            e.preventDefault();
            e.stopPropagation();
            onSelectRow({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
          }}
          // Keyboard parity: Space/Enter on the focused checkbox
          // dispatches the same select. shiftKey + metaKey work on
          // keyboard events too.
          onKeyDownCapture={(e) => {
            if (!onSelectRow) return;
            if (e.key !== ' ' && e.key !== 'Enter') return;
            e.preventDefault();
            e.stopPropagation();
            onSelectRow({ shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
          }}
        >
          <Checkbox
            checked={selected}
            disabled={!onSelectRow}
            aria-label="Select row"
            // tabIndex stays default so keyboard users can focus the
            // checkbox; the wrapping div's onKeyDownCapture handles
            // Space/Enter so the captured shift state survives.
          />
        </div>
      </td>
      {(() => {
        // The row's detail link hangs off the PRIMARY column when the schema
        // declares one (e.g. Media: Title is the link though Preview is first);
        // otherwise it falls back to the pinned-left column, else the first.
        const primaryKey = columns.find((c) => c.primary)?.key;
        const linkKey = primaryKey ?? pinnedLeftKey ?? columns[0]?.key ?? null;
        return columns.map((col, colIdx) => {
          const opts: Parameters<typeof renderCell>[3] = {};
          if (col.key === pinnedLeftKey) {
            opts.className = cn('sticky z-10', stickyBg, pinnedShadow);
            opts.style = { left: CHECKBOX_COL_WIDTH };
          }
          if (col.key === linkKey) opts.linkHref = detailHref;
          // Per-column render escape hatch + injected cell types.
          const override = cellOverrides?.[col.key];
          if (override) opts.override = override as (row: unknown) => ReactNode;
          if (cellRegistry) opts.registry = cellRegistry;
          return renderCell(col, row, colIdx, opts);
        });
      })()}
      <td
        style={{ width: ACTIONS_COL_WIDTH, minWidth: ACTIONS_COL_WIDTH, right: 0 }}
        className={cn(
          'sticky z-10 p-1 text-right align-middle',
          stickyBg,
          actionsShadow,
          depth > 0 && 'pr-4',
        )}
      >
        {renderRowActions ? renderRowActions(row) : null}
      </td>
    </TableRow>
  );
}

// Group rows by the value at `path`, preserving insertion order so
// the visual order matches the backend's ORDER BY.
function buildGroups<T>(rows: ReadonlyArray<T>, path: string): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const raw = getPath(row, path);
    const key = normaliseGroupKey(raw);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return Array.from(map.entries());
}

// Header cell in "text search" mode. Local draft state + debounced
// commit to ActiveFilters so typing doesn't fire a fetch per
// keystroke. Auto-focuses when first mounted (caller just flipped
// it into search mode). Escape or the X button clears + closes.
const HEADER_DEBOUNCE_MS = 300;
function HeaderSearchInput({
  label,
  value,
  onCommit,
  onClose,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onCommit(draft), HEADER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, value, onCommit]);
  return (
    <div className="flex h-full w-full items-center gap-1 px-2">
      <Search className="size-3.5 shrink-0 text-text-muted" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={draft}
        placeholder={label}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-subtle"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-surface-3 hover:text-text"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function normaliseGroupKey(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

// Build a Map<columnKey, Map<rawValue, label>> from the schema so
// group headers show human-friendly labels ("Active" instead of
// "active"). Only populated for enum / bool columns — ref columns
// show the raw distinct value (which equals the label in our shapes).
function groupingLabels(columns: ReadonlyArray<Column>): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const c of columns) {
    const inner = new Map<string, string>();
    if ((c.kind === 'enum' || c.kind === 'bool') && c.values) {
      for (const v of c.values) inner.set(v.value, v.label);
    }
    out.set(c.key, inner);
  }
  return out;
}

// Skeleton uses the real Table primitives so column widths,
// borders, padding, and scroll behaviour all match the eventual
// loaded state — switching from skeleton → data shouldn't shift
// the layout.
//
// `minWidth: DEFAULT_COL_WIDTH` per cell + the table's default
// `w-full` together gives the right behaviour at both ends:
//   - Few columns (e.g. Positions = 1 col): table stretches to
//     fill the container; cells distribute the extra space so the
//     skeleton spans full-width like the real table will.
//   - Many columns (e.g. Contractor jobs = 30+ cols): table grows
//     past container width; horizontal scroll appears, each cell
//     stays at 180px so skeleton bars stay readable.
//
// 30 rows is generous on purpose — fills typical viewports so the
// container looks "full of loading data" rather than half-empty.
const SKELETON_ROW_COUNT = 30;
const SKELETON_BAR_WIDTHS = ['w-16', 'w-24', 'w-20', 'w-32', 'w-16', 'w-28', 'w-20', 'w-24'];

function TableSkeleton({ columns }: { columns: ReadonlyArray<Column> }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto rounded-md border border-border">
      <Table className="[&_td]:border-b-0 [&_tr]:border-b-0 [&_tr:last-child_td]:border-b-0">
        <TableHeader className="[&_tr]:border-b-0">
          <TableRow className="border-b-0">
            <TableHead
              style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH }}
              className="h-10 bg-background shadow-[inset_0_-1px_0_var(--border)]"
            />
            {columns.map((c) => (
              <TableHead
                key={c.key}
                style={{ minWidth: DEFAULT_COL_WIDTH }}
                className="h-10 bg-background px-2 shadow-[inset_0_-1px_0_var(--border)]"
              >
                <Skeleton className="h-3 w-24" />
              </TableHead>
            ))}
            <TableHead
              style={{ width: ACTIONS_COL_WIDTH, minWidth: ACTIONS_COL_WIDTH }}
              className="h-10 bg-background shadow-[inset_0_-1px_0_var(--border)]"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIdx) => (
            <TableRow
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
              key={rowIdx}
              className="border-b border-border"
            >
              <TableCell
                style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH }}
                className="h-9 px-0"
              />
              {columns.map((c, colIdx) => (
                <TableCell key={c.key} style={{ minWidth: DEFAULT_COL_WIDTH }} className="h-9 px-2">
                  <Skeleton
                    className={cn(
                      'h-3',
                      SKELETON_BAR_WIDTHS[(rowIdx + colIdx) % SKELETON_BAR_WIDTHS.length],
                    )}
                  />
                </TableCell>
              ))}
              <TableCell
                style={{ width: ACTIONS_COL_WIDTH, minWidth: ACTIONS_COL_WIDTH }}
                className="h-9 px-0"
              />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ResizeGuideLine — sibling of <Table>, drawn while a column is
// being resized. Owns its own window-level mousemove listener and
// writes the cursor x straight to the line's `style.left` via ref.
// No useState, so the parent EntitySchemaTable never re-renders for
// cursor motion — critical on lists with thousands of rows where a
// per-pixel React re-render is multi-millisecond work.
function ResizeGuideLine({ containerEl }: { containerEl: HTMLDivElement }) {
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateFromPoint = (clientX: number) => {
      const line = lineRef.current;
      if (!line) return;
      const rect = containerEl.getBoundingClientRect();
      // `onEnd` resize mode means columns don't reflow during drag,
      // so cursor screen-x within the container is exactly where the
      // user wants the line — no scrollLeft compensation needed.
      const x = Math.max(0, clientX - rect.left);
      line.style.left = `${x}px`;
    };
    const onMouseMove = (e: MouseEvent) => updateFromPoint(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) updateFromPoint(e.touches[0].clientX);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [containerEl]);

  return (
    <div
      ref={lineRef}
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-50 w-px bg-primary"
      style={{ left: 0 }}
    />
  );
}
