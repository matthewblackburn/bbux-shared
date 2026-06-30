import type { LucideIcon } from 'lucide-react';

// A filterable field. Discriminated on `kind`:
//   - 'static': values are known upfront (enum-like), declared inline.
//   - 'async':  values are fetched on demand from `distinctUrl`. The
//               frontend appends `q`, `offset`, `limit` query params
//               so picker submenus can paginate + search.
//   - 'text':   free-text substring search. ActiveFilters[key] holds
//               a single-element array with the search term;
//               renderers present it as an <input>, not a picker.
export type FilterField = StaticFilterField | AsyncFilterField | TextFilterField;

export interface StaticFilterField {
  kind: 'static';
  key: string;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  values: ReadonlyArray<FilterValue>;
  // Optional global-count endpoint. Static enum filters like Status
  // carry inline values for the filter menu AND a distinct endpoint
  // so the chart panel can ask the server for real counts per value
  // instead of inferring from the loaded page. Same shape as
  // AsyncFilterField.distinctUrl — frontend appends q/offset/limit.
  distinctUrl?: string;
}

export interface AsyncFilterField {
  kind: 'async';
  key: string;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  // Base URL for the distinct endpoint. Frontend appends `q`,
  // `offset`, `limit` query params for paginated + searchable
  // pickers.
  distinctUrl: string;
}

export interface TextFilterField {
  kind: 'text';
  key: string;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
}

export interface FilterValue {
  value: string;
  label: string;
  count?: number;
}

// Active filters keyed by field key — values are the selected value
// strings. Empty arrays are pruned in the setter to keep the state
// small and chip rendering simple.
export type ActiveFilters = Record<string, string[]>;

export function toggleFilterValue(
  active: ActiveFilters,
  key: string,
  value: string,
): ActiveFilters {
  const current = active[key] ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  if (next.length === 0) {
    const { [key]: _dropped, ...rest } = active;
    return rest;
  }
  return { ...active, [key]: next };
}

export function clearFilterKey(active: ActiveFilters, key: string): ActiveFilters {
  const { [key]: _dropped, ...rest } = active;
  return rest;
}

// Set the value for a text filter. Empty / whitespace clears the
// key entirely (matches the "remove chip" UX). Always stores as a
// single-element array so the serializer and render paths don't
// need to distinguish text from multi-select.
export function setTextFilter(active: ActiveFilters, key: string, value: string): ActiveFilters {
  const trimmed = value.trim();
  if (trimmed === '') return clearFilterKey(active, key);
  return { ...active, [key]: [trimmed] };
}

export function getTextFilter(active: ActiveFilters, key: string): string {
  return active[key]?.[0] ?? '';
}

// Serialize to URL-style query params for the API. Each key becomes a
// comma-separated list so callers can do `qs['status'] = 'active,archived'`.
export function serializeFilters(active: ActiveFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, values] of Object.entries(active)) {
    if (values.length > 0) out[key] = values.join(',');
  }
  return out;
}
