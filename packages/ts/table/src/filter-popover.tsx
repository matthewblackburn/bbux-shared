import type {
  ActiveFilters,
  AsyncFilterField,
  FilterField,
  FilterValue,
  StaticFilterField,
  TextFilterField,
} from '@bbux/types';
import { clearFilterKey, getTextFilter, setTextFilter, toggleFilterValue } from '@bbux/types';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './dropdown-menu';
import { fetchDistinctPage } from './distinct';

// Filter menu content — bbux's REAL FilterPopover, copied verbatim from
// apps/web/src/components/entity-list/FilterPopover.tsx into @bbux/table so
// bbux can consume it with NO behavior change. Only the imports are rewired
// (@/components/ui/dropdown-menu → ./dropdown-menu, @/lib/utils → ./cn,
// ./types/filter-types → @bbux/types, ./utils/distinct → ./distinct) and an
// optional injected `loadOptions` was added so consumers without bbux's
// distinct endpoint (tcms) can still page reference options. bbux passes no
// loadOptions → the verbatim useInfiniteQuery + fetchDistinctPage path runs,
// byte-for-behavior identical to the app original.
//
// Goes inside a <DropdownMenuContent>. Each field has a hover-open submenu
// (DropdownMenuSub) with checkbox items for its values. Multi-select stays
// open across clicks.
//
// Both the field list and every value submenu are searchable. SearchInput
// uses a plain <input> and stops keydown propagation on printable keys so
// Radix's built-in typeahead doesn't swallow them; Escape still bubbles so
// the menu can close normally.
//
// Deliberately does NOT own the DropdownMenu root. Callers compose the full
// trigger stack so asChild ref + handler forwarding lands cleanly on the
// button leaf.
//
// tcms passes text-only fields (kind: 'text') with an ActiveFilters store —
// the text rows render + behave exactly as bbux's do.

/** Injected loader for a field's selectable values (async / reference, or
 *  static fields that want server-provided counts). When provided, a picker
 *  submenu loads its options once from this instead of bbux's paginated
 *  distinct endpoint. bbux omits it (its `fetchDistinctPage` default runs). */
export type LoadOptions = (field: FilterField) => Promise<ReadonlyArray<FilterValue>>;

export interface FilterPopoverProps {
  fields: ReadonlyArray<FilterField>;
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  /** Optional injected reference-option loader (async/static-remote). */
  loadOptions?: LoadOptions;
}

export function FilterPopover({ fields, active, onChange, loadOptions }: FilterPopoverProps) {
  const [fieldSearch, setFieldSearch] = useState('');
  const filteredFields = useMemo(
    () => fields.filter((f) => f.label.toLowerCase().includes(fieldSearch.toLowerCase().trim())),
    [fields, fieldSearch],
  );

  // Two groups: picker (static + async share the submenu value-picker
  // UI) then text inputs at the bottom, separated by a divider.
  const pickerFields = filteredFields.filter((f) => f.kind === 'static' || f.kind === 'async');
  const textFields = filteredFields.filter((f): f is TextFilterField => f.kind === 'text');

  const empty = filteredFields.length === 0;

  return (
    <>
      <SearchInput placeholder="Add filter…" value={fieldSearch} onChange={setFieldSearch} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this div
          delegates keyboard events from the interactive menuitems
          nested inside — it's an event interceptor, not a focusable
          target itself. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1" onKeyDown={handleFilterMenuArrowNav}>
        {empty ? (
          <EmptyRow>No matches.</EmptyRow>
        ) : (
          <>
            {pickerFields.map((field) => (
              <FieldRow
                key={field.key}
                field={field}
                active={active}
                onChange={onChange}
                loadOptions={loadOptions}
              />
            ))}
            {pickerFields.length > 0 && textFields.length > 0 ? <DropdownMenuSeparator /> : null}
            {textFields.map((field) => (
              <TextFieldRow key={field.key} field={field} active={active} onChange={onChange} />
            ))}
          </>
        )}
      </div>
    </>
  );
}

/** bbux imports this component as `FilterMenuItems`. Kept as an alias so
 *  bbux's `import { FilterMenuItems }` continues to resolve unchanged. */
export const FilterMenuItems = FilterPopover;
export type FilterMenuItemsProps = FilterPopoverProps;

function FieldRow({
  field,
  active,
  onChange,
  loadOptions,
}: {
  field: FilterField;
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  loadOptions?: LoadOptions;
}) {
  if (field.kind === 'text') {
    // Text filters are handled by TextFieldRow — this guard keeps
    // TypeScript happy when the caller uses a single list type.
    return null;
  }
  const selected = active[field.key] ?? [];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={`popover-filter-${field.key}`}>
        <field.icon className={field.iconClassName} />
        <span>{field.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="flex max-h-[min(60vh,420px)] w-56 flex-col overflow-hidden p-0">
        <ValueList
          field={field as StaticFilterField | AsyncFilterField}
          selected={selected}
          active={active}
          onChange={onChange}
          loadOptions={loadOptions}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

// Inline debounced text input row. Reads the current value from
// ActiveFilters, writes back after DEBOUNCE_MS of inactivity so a
// fast typist doesn't trigger a fetch per keystroke. Escape clears.
// Printable keydowns stop propagation so Radix's typeahead doesn't
// steal characters. The containing DropdownMenu stays open because
// we don't use DropdownMenuItem — a plain div can't be "selected".
function TextFieldRow({
  field,
  active,
  onChange,
}: {
  field: TextFilterField;
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
}) {
  const committed = getTextFilter(active, field.key);
  const draft = useDebouncedText(committed, (next) =>
    onChange(setTextFilter(active, field.key, next)),
  );
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
      <field.icon className={cn('size-3.5 shrink-0', field.iconClassName)} />
      <span className="w-20 shrink-0 truncate text-text-muted">{field.label}</span>
      <input
        type="text"
        data-filter-text
        data-testid={`popover-filter-${field.key}`}
        value={draft.value}
        onChange={(e) => draft.set(e.target.value)}
        placeholder="Contains…"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-subtle"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            draft.set('');
            onChange(clearFilterKey(active, field.key));
            return;
          }
          // Stop printable keys from reaching Radix's typeahead.
          // Arrow keys bubble up to handleFilterMenuArrowNav on the
          // wrapper, which routes focus between inputs + menu items.
          const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
          if (printable) e.stopPropagation();
        }}
      />
    </div>
  );
}

// 300ms debounce on a text input. Caller receives local draft
// (update as fast as the user types) and a commit callback that
// fires once typing settles. Syncs back to the external value
// when it changes (e.g. another surface cleared the filter).
const DEBOUNCE_MS = 300;
function useDebouncedText(
  committed: string,
  commit: (next: string) => void,
): { value: string; set: (next: string) => void } {
  const [value, setValue] = useState(committed);
  useEffect(() => setValue(committed), [committed]);
  useEffect(() => {
    if (value === committed) return;
    const t = setTimeout(() => commit(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, committed, commit]);
  return { value, set: setValue };
}

function ValueList({
  field,
  selected,
  active,
  onChange,
  loadOptions,
}: {
  field: StaticFilterField | AsyncFilterField;
  selected: ReadonlyArray<string>;
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  loadOptions?: LoadOptions;
}) {
  const [valueSearch, setValueSearch] = useState('');
  // Debounce server-side search so we don't fire a request on every
  // keystroke. 200ms feels responsive without thrashing the API.
  const debouncedSearch = useDebouncedValue(valueSearch, 200);

  // Pick the distinct URL. Async fields always have one; static
  // fields carry one when the schema column declared a distinct_path
  // (Status, Stage, …) so the picker shows real counts.
  const distinctUrl =
    field.kind === 'async'
      ? field.distinctUrl
      : field.kind === 'static'
        ? field.distinctUrl
        : undefined;

  // When a consumer injects `loadOptions`, it owns the reference lookup and
  // the built-in distinct pagination is bypassed. Otherwise fall back to
  // bbux's paginated fetchDistinctPage path (identical to the app original).
  const injected = Boolean(loadOptions && distinctUrl);
  const enabled = Boolean(distinctUrl) && !injected;

  const PAGE = 50;
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ['distinct', distinctUrl ?? '', debouncedSearch],
      queryFn: ({ pageParam }) =>
        fetchDistinctPage(distinctUrl ?? '', {
          q: debouncedSearch,
          offset: pageParam as number,
          limit: PAGE,
        }),
      getNextPageParam: (lastPage) => {
        const next = lastPage.offset + lastPage.limit;
        return next < lastPage.total ? next : undefined;
      },
      initialPageParam: 0,
      enabled,
    });

  // Injected-loader state: load once when a consumer supplies loadOptions.
  const [injectedOpts, setInjectedOpts] = useState<ReadonlyArray<FilterValue> | null>(null);
  const [injectedLoading, setInjectedLoading] = useState(false);
  const [injectedError, setInjectedError] = useState(false);
  useEffect(() => {
    if (!injected || !loadOptions || injectedOpts !== null) return;
    let cancelled = false;
    setInjectedLoading(true);
    setInjectedError(false);
    loadOptions(field)
      .then((opts) => {
        if (!cancelled) setInjectedOpts(opts);
      })
      .catch(() => {
        if (!cancelled) setInjectedError(true);
      })
      .finally(() => {
        if (!cancelled) setInjectedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [injected, loadOptions, injectedOpts, field]);

  const fetched = useMemo(
    () => (data ? data.pages.flatMap((p) => p.data) : []),
    [data],
  ) as ReadonlyArray<FilterValue>;
  const inline: ReadonlyArray<FilterValue> = field.kind === 'static' ? field.values : [];

  // Static filters with both inline values AND a distinct URL: fall
  // back to inline whenever the distinct returns empty (e.g. Customer
  // Stage on a tenant where no quote has been classified yet). For
  // active server search we narrow inline locally so the user can
  // still pick from configured values.
  const useFetched = enabled && fetched.length > 0;
  const inlineFiltered = useMemo(() => {
    if (!debouncedSearch) return inline;
    const needle = debouncedSearch.toLowerCase();
    return inline.filter(
      (v) => v.label.toLowerCase().includes(needle) || v.value.toLowerCase().includes(needle),
    );
  }, [inline, debouncedSearch]);

  // Injected options are searched client-side (the loader returns a full set).
  const injectedFiltered = useMemo(() => {
    const opts = injectedOpts ?? [];
    if (!debouncedSearch) return opts;
    const needle = debouncedSearch.toLowerCase();
    return opts.filter(
      (v) => v.label.toLowerCase().includes(needle) || v.value.toLowerCase().includes(needle),
    );
  }, [injectedOpts, debouncedSearch]);

  const values: ReadonlyArray<FilterValue> = injected
    ? injectedFiltered
    : useFetched
      ? fetched
      : inlineFiltered;
  const loading = injected ? injectedLoading : enabled && isLoading;
  const failed = injected ? injectedError : Boolean(error);

  // Sentinel-driven scroll-to-load-more. Only attaches when there's
  // a next page to fetch; reconnects on isFetchingNextPage flip so
  // an in-flight fetch doesn't strand the observer.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const container = containerRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage();
      },
      { root: container, rootMargin: '60px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <>
      <SearchInput placeholder={`${field.label}…`} value={valueSearch} onChange={setValueSearch} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: this div
          delegates keyboard events from the interactive menuitems
          nested inside — it's an event interceptor, not a focusable
          target itself. */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-y-auto p-1"
        onKeyDown={handleFilterMenuArrowNav}
      >
        {loading ? (
          <LoadingRow />
        ) : failed && values.length === 0 ? (
          <EmptyRow>Failed to load values.</EmptyRow>
        ) : values.length === 0 ? (
          <EmptyRow>No matches.</EmptyRow>
        ) : (
          <>
            {values.map((v) => (
              <DropdownMenuCheckboxItem
                key={v.value}
                checked={selected.includes(v.value)}
                onCheckedChange={() => onChange(toggleFilterValue(active, field.key, v.value))}
                // Keep the menu open across clicks for multi-select.
                onSelect={(e) => e.preventDefault()}
              >
                <span className="flex-1">{v.label}</span>
                {v.count != null ? (
                  <span className="ml-2 text-xs tabular-nums text-text-muted">{v.count}</span>
                ) : null}
              </DropdownMenuCheckboxItem>
            ))}
            {hasNextPage ? (
              <div ref={sentinelRef} className="flex h-8 items-center justify-center">
                {isFetchingNextPage ? (
                  <Loader2 className="size-3.5 animate-spin text-text-muted" />
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

// useDebouncedValue returns `value` after `delay` ms of stillness.
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function SearchInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Imperatively focus on mount instead of using autoFocus — biome
  // flags the attribute, but focusing inside a menu that only opens
  // in response to user action is the expected UX.
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
      <Search className="size-3.5 text-text-muted" aria-hidden />
      <input
        ref={ref}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // ArrowDown moves focus from the input into the first menu
          // item. Radix's built-in nav only moves between items in
          // its collection — the input isn't registered there, so
          // we have to jump focus ourselves on first keypress.
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const menu = (e.currentTarget as HTMLInputElement).closest('[role="menu"]');
            const first = menu?.querySelector<HTMLElement>(
              '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
            );
            first?.focus();
            return;
          }
          // Swallow printable characters so Radix's typeahead doesn't
          // eat our typing. Escape / Tab / Enter bubble so Radix can
          // close / tab / activate as usual.
          const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
          if (printable) e.stopPropagation();
        }}
        className="w-full bg-transparent text-sm outline-none placeholder:text-text-muted"
      />
    </div>
  );
}

// Keyboard navigation that Radix's built-in roving tabindex misses:
// Radix only sees elements with role="menuitem*" in its collection,
// but the text-filter rows render a plain <input data-filter-text>
// (a focusable input nested inside a DropdownMenuItem would fight
// Radix for focus; a plain input sidesteps that but breaks arrow
// nav entirely). This handler sits on each list wrapper and routes
// focus for four cases:
//
//   • ArrowUp  from the first menuitem → search input (above wrapper)
//   • ArrowDown from the last menuitem  → first text input (below)
//   • ArrowUp/Down between text inputs
//   • ArrowUp  from the first text input → last menuitem
//
// Each transition calls preventDefault + stopPropagation so Radix's
// own ArrowUp/Down handler at the content root doesn't also act on
// the same event. Non-transition cases are left alone so Radix's
// normal item-to-item nav keeps working.
function handleFilterMenuArrowNav(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const wrapper = e.currentTarget;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;

  const menuItems = Array.from(
    wrapper.querySelectorAll<HTMLElement>(
      '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]',
    ),
  );
  const textInputs = Array.from(
    wrapper.querySelectorAll<HTMLInputElement>('input[data-filter-text]'),
  );

  const textIdx = active instanceof HTMLInputElement ? textInputs.indexOf(active) : -1;
  const firstMenu = menuItems[0];
  const lastMenu = menuItems[menuItems.length - 1];

  if (e.key === 'ArrowUp') {
    // First menu item → search input (sibling above the wrapper).
    if (active === firstMenu) {
      const searchInput = wrapper.parentElement?.querySelector<HTMLInputElement>(
        'input[type="text"]:not([data-filter-text])',
      );
      if (searchInput) {
        e.preventDefault();
        e.stopPropagation();
        searchInput.focus();
      }
      return;
    }
    // First text input → last menu item.
    if (textIdx === 0 && lastMenu) {
      e.preventDefault();
      e.stopPropagation();
      lastMenu.focus();
      return;
    }
    // Later text input → previous text input.
    if (textIdx > 0) {
      e.preventDefault();
      e.stopPropagation();
      textInputs[textIdx - 1].focus();
    }
    return;
  }

  // ArrowDown
  // Last menu item → first text input.
  if (active === lastMenu && textInputs.length > 0) {
    e.preventDefault();
    e.stopPropagation();
    textInputs[0].focus();
    return;
  }
  // Text input → next text input.
  if (textIdx !== -1 && textIdx + 1 < textInputs.length) {
    e.preventDefault();
    e.stopPropagation();
    textInputs[textIdx + 1].focus();
  }
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-6 text-center text-sm text-text-muted">{children}</div>;
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-text-muted">
      <Loader2 className="size-3.5 animate-spin" />
      Loading…
    </div>
  );
}
