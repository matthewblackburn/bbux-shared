import { useQuery } from '@tanstack/react-query';
import type { ActiveFilters, FilterField, FilterValue } from '@bbux/types';
import { clearFilterKey } from '@bbux/types';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from './button';
import { cn } from './cn';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu';
import { FilterMenuItems } from './filter-popover';

// Row of active filter chips. Each chip reads "<Field> is <value(s)> ×"
// and the trailing + opens the filter menu to add another. Clear
// drops all filters at once.
//
// For async fields the chip reads labels from the same TanStack Query
// cache the submenu populates, so opening the submenu once shares
// labels with every chip after.

export interface FilterChipsProps {
  fields: ReadonlyArray<FilterField>;
  active: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
}

export function FilterChips({ fields, active, onChange }: FilterChipsProps) {
  const [addOpen, setAddOpen] = useState(false);
  const userKeys = Object.keys(active);
  if (userKeys.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {userKeys.map((key) => {
        const field = fields.find((f) => f.key === key);
        if (!field) return null;
        return (
          <Chip
            key={key}
            field={field}
            values={active[key] ?? []}
            onRemove={() => onChange(clearFilterKey(active, key))}
          />
        );
      })}
      {fields.length > 0 ? (
        <DropdownMenu open={addOpen} onOpenChange={setAddOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add filter"
              className="text-text-muted hover:text-text"
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="flex max-h-[min(60vh,420px)] w-56 flex-col overflow-hidden p-0"
          >
            <FilterMenuItems fields={fields} active={active} onChange={onChange} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {userKeys.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-text-muted hover:text-text"
          onClick={() => onChange({})}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );
}

function Chip({
  field,
  values,
  onRemove,
}: {
  field: FilterField;
  values: ReadonlyArray<string>;
  onRemove: () => void;
}) {
  const fieldValues = useFieldValues(field);
  const labelMap = new Map(fieldValues.map((v) => [v.value, v.label]));
  // Text filters show "contains <query>" instead of the enum-style
  // "is <value>". Values array holds a single trimmed search term
  // (setTextFilter ensures that), so values[0] is safe.
  const isText = field.kind === 'text';
  const verb = isText ? 'contains' : 'is';
  const valueLabel = isText
    ? (values[0] ?? '')
    : values.length > 2
      ? `${values.length} selected`
      : values.map((v) => labelMap.get(v) ?? v).join(', ');

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-surface text-xs',
        'divide-x divide-border',
      )}
    >
      <span className="inline-flex items-center gap-1 px-2 py-1 text-text-muted">
        <field.icon className={cn('size-3', field.iconClassName)} />
        {field.label}
      </span>
      <span className="px-2 py-1 text-text-muted">{verb}</span>
      <span className="px-2 py-1 text-text">{valueLabel}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${field.label} filter`}
        className="px-1.5 py-1 text-text-muted hover:text-text"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

// Read the value list for a field — inline for static, from TanStack
// Query cache for async. The submenu primes the cache on open; chip
// labels resolve from there. Until the cache warms we fall back to
// raw value strings, which is acceptable for a brief first-paint.
//
// The submenu uses useInfiniteQuery with key ['distinct', url, '']
// (empty search). We read the first page from the cache here — that
// covers the most common chip cases (small enums, top-N refs) and
// gracefully degrades to raw value strings for tail values that
// haven't been paged into the cache yet.
function useFieldValues(field: FilterField): ReadonlyArray<FilterValue> {
  const distinctUrl =
    field.kind === 'async'
      ? field.distinctUrl
      : field.kind === 'static'
        ? field.distinctUrl
        : undefined;
  const { data } = useQuery({
    queryKey: ['distinct', distinctUrl ?? '', ''],
    queryFn: async () => [] as FilterValue[],
    enabled: false, // we only read what the submenu has primed
  });
  // useInfiniteQuery primes data as { pages: [...] }; useQuery here
  // types it as a flat array. Read defensively.
  let fromCache: ReadonlyArray<FilterValue> = [];
  if (Array.isArray(data)) {
    fromCache = data;
  } else if (data && typeof data === 'object' && 'pages' in data) {
    const pages = (data as { pages: Array<{ data?: ReadonlyArray<FilterValue> }> }).pages;
    fromCache = pages.flatMap((p) => p.data ?? []);
  }
  if (fromCache.length > 0) return fromCache;
  if (field.kind === 'static') return field.values;
  // text filters don't have a value catalogue; chip renders the
  // raw search term.
  return [];
}
