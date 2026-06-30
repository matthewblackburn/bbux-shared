import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TableColumn } from './types';

// Filter popover BODY — one debounced text input per filterable column.
// The Popover wrapper (trigger + chrome) stays in the consumer's
// toolbar; this is just the body rendered inside it.
//
// `fields` should already be the filterable subset (or this filters by
// `textFilterable` itself). `filters` is a flat Record<id,string>; an
// empty string means "no filter".

const FILTER_DEBOUNCE_MS = 250;

export interface FilterPopoverProps {
  /** Columns to expose as filter rows. Non-text-filterable columns are skipped. */
  fields: TableColumn[];
  /** Current per-column filter values, keyed by column id. */
  filters: Record<string, string>;
  /** Called (debounced) when a column's filter text changes. */
  onFilterChange: (id: string, value: string) => void;
}

export function FilterPopover({ fields, filters, onFilterChange }: FilterPopoverProps) {
  const rows = fields.filter((f) => f.textFilterable);
  return (
    <div className="flex max-h-[min(60vh,420px)] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-border border-b px-2 py-1.5 text-muted-foreground text-sm">
        <Search className="size-3.5" aria-hidden />
        Filter columns
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.map((field) => (
          <FilterTextRow
            key={field.id}
            field={field}
            value={filters[field.id] ?? ''}
            onChange={(next) => onFilterChange(field.id, next)}
          />
        ))}
      </div>
    </div>
  );
}

function FilterTextRow({
  field,
  value,
  onChange,
}: {
  field: TableColumn;
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
        data-testid={`popover-filter-${field.id}`}
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
