import type { ActiveFilters, FilterField, FilterValue } from '@bbux/types';
import {
  clearFilterKey,
  getTextFilter,
  setTextFilter,
  toggleFilterValue,
} from '@bbux/types';
import { Check, ChevronRight, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from './cn';

// Filter popover BODY — the superset of tcms's text-only column filter
// and bbux's schema-driven filter menu. The Popover wrapper (trigger +
// chrome) stays in the consumer's toolbar; this is only the body
// rendered inside it.
//
// Fields are a @bbux/types `FilterField` discriminated union:
//   - 'text':   free-text "contains" row (debounced input).
//   - 'static': enum with inline `values` → multi-select checkbox picker.
//   - 'async':  reference field whose options are loaded on demand via
//               the injected `loadOptions` callback → multi-select picker.
//
// tcms passes ONLY text fields (and its flat filters/onFilterChange
// state) → behaves exactly as before. bbux passes text + static + async
// with ActiveFilters/onChange.
//
// Two state shapes are supported (pick one; they're mutually exclusive):
//
//   SIMPLE (tcms, text-only):
//     <FilterPopover
//       fields={textFields}
//       filters={Record<string,string>}
//       onFilterChange={(key, value) => …}
//     />
//
//   RICH (bbux, text + enum + reference):
//     <FilterPopover
//       fields={fields}
//       active={ActiveFilters}
//       onChange={(next) => …}
//       loadOptions={(field) => Promise<FilterValue[]>}   // for async/static-remote
//     />
//
// Async / reference options are injected via `loadOptions` — the package
// never couples to bbux's GraphQL or any transport. tcms simply omits it
// (it has no reference fields).

const FILTER_DEBOUNCE_MS = 250;

/** Injected loader for a field's selectable values (async / reference,
 *  or static fields that want server-provided counts). Called once when
 *  a picker row is first expanded; results are cached per field key. */
export type LoadOptions = (field: FilterField) => Promise<ReadonlyArray<FilterValue>>;

interface FilterPopoverBaseProps {
  /** Fields to expose as filter rows. */
  fields: ReadonlyArray<FilterField>;
  /** Loader for async/reference (and static-remote) option lists. */
  loadOptions?: LoadOptions;
}

/** SIMPLE mode — flat text-only state (tcms). Only `text` fields are
 *  rendered; static/async fields are ignored because there is no
 *  ActiveFilters store to hold multi-selections. */
interface FilterPopoverSimpleProps extends FilterPopoverBaseProps {
  /** Current per-field filter values, keyed by field key. */
  filters: Record<string, string>;
  /** Called (debounced) when a text field's value changes. */
  onFilterChange: (key: string, value: string) => void;
  active?: never;
  onChange?: never;
}

/** RICH mode — ActiveFilters state (bbux). Handles text + multi-select. */
interface FilterPopoverRichProps extends FilterPopoverBaseProps {
  /** Active filters keyed by field key (arrays of selected values). */
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  filters?: never;
  onFilterChange?: never;
}

export type FilterPopoverProps = FilterPopoverSimpleProps | FilterPopoverRichProps;

// Normalise the two state shapes into one internal accessor set so the
// row components don't branch on mode. SIMPLE mode lifts the flat record
// into an ActiveFilters-like view (text → single-element array) and only
// exposes text getters/setters (picker rows are hidden in that mode).
interface FilterState {
  /** Selected values for a picker field. */
  selected: (key: string) => ReadonlyArray<string>;
  /** Committed text for a text field. */
  text: (key: string) => string;
  setText: (key: string, value: string) => void;
  toggle: (key: string, value: string) => void;
  /** True when picker (static/async) fields are supported by this state. */
  pickersEnabled: boolean;
}

function useFilterState(props: FilterPopoverProps): FilterState {
  if (props.active !== undefined) {
    const { active, onChange } = props;
    return {
      selected: (key) => active[key] ?? [],
      text: (key) => getTextFilter(active, key),
      setText: (key, value) => onChange(setTextFilter(active, key, value)),
      toggle: (key, value) => onChange(toggleFilterValue(active, key, value)),
      pickersEnabled: true,
    };
  }
  const { filters, onFilterChange } = props;
  return {
    selected: () => [],
    text: (key) => filters[key] ?? '',
    setText: (key, value) => onFilterChange(key, value),
    toggle: () => {},
    pickersEnabled: false,
  };
}

export function FilterPopover(props: FilterPopoverProps) {
  const state = useFilterState(props);
  const { fields, loadOptions } = props;

  // In SIMPLE (text-only) mode, non-text fields have no place to store a
  // multi-selection, so they're dropped. In RICH mode all kinds render.
  const rows = useMemo(
    () => (state.pickersEnabled ? fields : fields.filter((f) => f.kind === 'text')),
    [fields, state.pickersEnabled],
  );

  return (
    <div className="flex max-h-[min(60vh,420px)] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-border border-b px-2 py-1.5 text-muted-foreground text-sm">
        <Search className="size-3.5" aria-hidden />
        Filter columns
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.map((field) =>
          field.kind === 'text' ? (
            <FilterTextRow
              key={field.key}
              field={field}
              value={state.text(field.key)}
              onChange={(next) => state.setText(field.key, next)}
            />
          ) : (
            <FilterPickerRow
              key={field.key}
              field={field}
              selected={state.selected(field.key)}
              onToggle={(value) => state.toggle(field.key, value)}
              loadOptions={loadOptions}
            />
          ),
        )}
      </div>
    </div>
  );
}

function FilterTextRow({
  field,
  value,
  onChange,
}: {
  field: FilterField;
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, value, onChange]);
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
      <span className="w-28 shrink-0 truncate text-muted-foreground">{field.label}</span>
      <input
        type="text"
        value={draft}
        placeholder="Contains…"
        data-testid={`popover-filter-${field.key}`}
        onChange={(e) => setDraft(e.target.value)}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
      {draft ? (
        <button
          type="button"
          aria-label={`Clear ${field.label} filter`}
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// Multi-select picker for a static (inline values) or async (reference)
// field. Renders an expandable header row; expanding it reveals a
// searchable checkbox list. Static fields have inline `values`; async
// fields (and static fields with no inline values) load their options
// once via the injected `loadOptions` callback.
//
// Rendered inline inside the Popover body (not a Radix submenu) so the
// package stays decoupled from any DropdownMenu implementation — see the
// report note on what could NOT be cleanly ported from bbux.
function FilterPickerRow({
  field,
  selected,
  onToggle,
  loadOptions,
}: {
  field: FilterField;
  selected: ReadonlyArray<string>;
  onToggle: (value: string) => void;
  loadOptions?: LoadOptions;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inlineValues: ReadonlyArray<FilterValue> =
    field.kind === 'static' ? field.values : [];
  const [loaded, setLoaded] = useState<ReadonlyArray<FilterValue> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // Load remote options lazily the first time the row is expanded.
  // Async fields always load; static fields load only when they have no
  // inline values (a static field with inline values renders those and
  // never calls loadOptions).
  const needsLoad = field.kind === 'async' || (field.kind === 'static' && inlineValues.length === 0);
  useEffect(() => {
    if (!open || !needsLoad || loaded !== null || !loadOptions) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadOptions(field)
      .then((opts) => {
        if (!cancelled) setLoaded(opts);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, needsLoad, loaded, loadOptions, field]);

  const values: ReadonlyArray<FilterValue> = loaded ?? inlineValues;
  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    if (!needle) return values;
    return values.filter(
      (v) => v.label.toLowerCase().includes(needle) || v.value.toLowerCase().includes(needle),
    );
  }, [values, search]);

  const count = selected.length;

  return (
    <div className="text-sm">
      <button
        type="button"
        data-testid={`popover-filter-${field.key}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-foreground">{field.label}</span>
        {count > 0 ? (
          <span className="ml-2 rounded-full bg-primary/15 px-1.5 text-primary text-xs tabular-nums">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="pb-1 pl-4" data-testid={`popover-filter-values-${field.key}`}>
          <div className="mb-1 flex items-center gap-2 px-2">
            <Search className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <input
              type="text"
              value={search}
              placeholder={`${field.label}…`}
              data-testid={`popover-filter-search-${field.key}`}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground text-sm">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : error && values.length === 0 ? (
            <div className="px-2 py-4 text-center text-muted-foreground text-sm">
              Failed to load values.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-4 text-center text-muted-foreground text-sm">No matches.</div>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {filtered.map((v) => {
                const checked = selected.includes(v.value);
                return (
                  <button
                    key={v.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    data-testid={`popover-filter-option-${field.key}-${v.value}`}
                    onClick={() => onToggle(v.value)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                      )}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{v.label}</span>
                    {v.count != null ? (
                      <span className="ml-2 text-muted-foreground text-xs tabular-nums">{v.count}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
