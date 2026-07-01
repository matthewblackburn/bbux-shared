import type { ActiveFilters, FilterField, ListSchema, TableSettings } from '@bbux/types';
import type { ReactNode } from 'react';

// RowActionsConfig drives the per-row "⋯" menu (RowActions) on a list. A page
// describes its entity's capabilities; the table builds the menu per row. Copy
// ID + Edit are universal (derived from the row id + detailPathBase); a page
// opts into Set status / Delete by providing the relevant handlers.
export interface RowActionsConfig<T> {
  /** Lowercase noun for the delete-confirm dialog, e.g. "article", "role". */
  entityNoun: string;
  /** The row's display name (delete-confirm prompt + a11y). */
  nameOf: (row: T) => string;
  /** When set, a Delete item opens the type-to-confirm modal then runs this. */
  onDelete?: (row: T) => Promise<unknown>;
  /** Per-row gate for Delete (e.g. hide on base definitions). Default: allowed. */
  canDelete?: (row: T) => boolean;
  /** When set, a "Set status" submenu of these options is shown. */
  status?: {
    options: readonly string[];
    valueOf: (row: T) => string | undefined;
    onChange: (row: T, status: string) => Promise<unknown>;
  };
  /** The entity's base type — the tag_links resource type, enabling tagging in
   *  the actions menu. Omit to hide the "Add tag" action. */
  baseType?: string;
  /** Tag API — INJECTED so the shared table carries no app data layer. Provide
   *  alongside `baseType` to enable the Add/remove-tags action; omit either and
   *  the tags UI is hidden (tcms omits both). */
  tags?: TagApi;
  /** The list's React Query key (the entity's listField) — invalidated after a
   *  bulk action so the grid (status / tags columns) refreshes. */
  listField?: string;
  /** Extra per-row menu items beyond the built-ins (Copy ID / Edit / status /
   *  delete). Rendered in the single-row "⋯" menu. Lets consumers add bespoke
   *  actions the fixed config can't express — e.g. a cascade-reassign delete,
   *  or view/edit navigation. Return [] (or set hidden) to omit for a row. */
  customActions?: (row: T) => ReadonlyArray<CustomRowAction>;
}

export interface CustomRowAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Renders in the danger colour (e.g. Delete). */
  danger?: boolean;
  /** When true the item is skipped (e.g. locked/system rows). */
  hidden?: boolean;
}

/** Minimal tag API the bulk-actions menu needs; the consumer supplies its own
 *  implementation (e.g. bbux's tagsApi). Keeps @bbux/table data-layer-free. */
export interface TagApi {
  options: () => Promise<ReadonlyArray<TagOption>>;
  forResource: (baseType: string, id: string) => Promise<ReadonlyArray<{ id: string }>>;
  tag: (baseType: string, id: string, tagId: string) => Promise<unknown>;
  untag: (baseType: string, id: string, tagId: string) => Promise<unknown>;
}

export interface TagOption {
  id: string;
  title: string;
  icon?: string;
  color?: string;
}

// Shared shape the EntitySchemaTable writes into its surrounding
// layout (People, eventually Quotes / Jobs / Invoices). The layout
// owns the toolbar chrome + filter chips + page title row; the
// table owns the schema / filters / display knobs. They meet here.
//
// Feature layouts consume EntityListOutletContext via
// react-router's useOutletContext and feed EntityListToolbarState
// to their toolbar. Nothing in this shape is entity-specific — any
// list page can use it.

export interface EntityListOutletContext {
  setToolbar: (value: EntityListToolbarState | null) => void;
}

export interface EntityListToolbarState {
  title: string;
  total?: number;
  newLabel: string;
  // When set, the toolbar's New button is enabled and calls this.
  onNew?: () => void;
  filterFields?: ReadonlyArray<FilterField>;
  // Filter fields whose values are locked by the tab preset. Shown as
  // non-clearable chips; excluded from the filter menu.
  lockedFilterFields?: ReadonlyArray<FilterField>;
  activeFilters?: ActiveFilters;
  onFiltersChange?: (next: ActiveFilters) => void;
  // Immutable filters applied by the tab preset. The user cannot clear
  // them — they define what this tab *is* (e.g. Unpaid = is_paid:false).
  lockedFilters?: ActiveFilters;
  schema?: ListSchema;
  tableSettings?: TableSettings;
  onTableSettingsChange?: (next: TableSettings) => void;
  // Chart support (bbux): count(where)→total + the current table where, so the
  // chart computes exact per-value counts over GraphQL.
  chartCount?: (where: Record<string, unknown>) => Promise<number>;
  chartBaseWhere?: Record<string, unknown>;
  // The definition the list is scoped to — so the chart's cache key changes
  // per definition (the count fn is already definition-scoped).
  chartDefinitionId?: string;
  // Optional left-aligned slot rendered inline with the toolbar
  // buttons (typically a Tabs strip from a nested layout). Set when
  // a child layout — e.g. ArchiveReasonsLayout under SettingsLayout —
  // wants its tabs to share the toolbar row instead of stacking
  // below it. See ArchiveReasonsLayout for how to inject one.
  tabsSlot?: ReactNode;
  // Page-specific icon buttons rendered alongside (or instead of)
  // EntityToolbar's filter/display/chart/new cluster. Use for
  // detail-page actions like "Edit" on a dashboard, "Save" + "Add
  // card" on a builder, or anything that doesn't fit the
  // list-view-toolbar mould. Caller is responsible for icon-sm
  // ghost buttons that match the toolbar's visual rhythm.
  actions?: ReactNode;
  // Already-serialized merge of activeFilters + lockedFilters,
  // forwarded to EntityToolbar → ChartPanel so chart counts mirror
  // the same row slice the table is rendering.
  effectiveFilters?: Record<string, string>;
}
