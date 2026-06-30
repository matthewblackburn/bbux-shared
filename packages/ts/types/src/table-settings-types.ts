// Minimal structural shape of the list schema these helpers need: a set of
// columns, each carrying a `key`. The bbux app's full `ListSchema`
// (@bbux/shared-types) is structurally assignable to this, and external
// consumers can supply their own column source without depending on bbux's
// generated types — keeping @bbux/types dependency-free.
export interface ColumnLike {
  key: string;
}
export interface ListSchemaLike {
  columns: ReadonlyArray<ColumnLike>;
}

// TableSettings holds the per-tab display preferences the user
// controls via the "Display options" popover. All local state for
// now — when user preferences land in /v1/bootstrap, this shape
// slots straight into `preferences.displaySettings[entity]`.

export interface TableSettings {
  groupBy: string | null;
  subGroupBy: string | null;
  orderBy: string | null;
  orderDirection: 'asc' | 'desc';
  visibleColumns: ReadonlyArray<string>;
  // Per-column pixel widths. Empty = auto layout; any entry flips
  // the table into table-layout: fixed and locks those columns at
  // the specified size. Managed by @tanstack/react-table on our
  // behalf during drags, committed here on drop.
  columnWidths: Record<string, number>;
}

// Derive sensible defaults from the schema: every column visible,
// no grouping, no explicit ordering (backend default applies).
export function defaultTableSettings(schema: ListSchemaLike): TableSettings {
  return {
    groupBy: null,
    subGroupBy: null,
    orderBy: null,
    orderDirection: 'desc',
    visibleColumns: schema.columns.map((c) => c.key),
    columnWidths: {},
  };
}

// A column is visible when its key appears in the settings' visible
// set. Empty visible list means "all visible" — the UI disallows
// dropping all columns but we belt-and-brace.
export function isColumnVisible(settings: TableSettings, key: string): boolean {
  if (settings.visibleColumns.length === 0) return true;
  return settings.visibleColumns.includes(key);
}

export function toggleColumn(settings: TableSettings, key: string): TableSettings {
  const visible = settings.visibleColumns.includes(key);
  const next = visible
    ? settings.visibleColumns.filter((k) => k !== key)
    : [...settings.visibleColumns, key];
  // Don't let the user hide everything — leave the last column in.
  if (next.length === 0) return settings;
  return { ...settings, visibleColumns: next };
}

// True when any knob in the popover differs from the schema's
// defaults (default grouping = none, default ordering = none desc,
// all columns visible). Drives the dirty-state dot on the Display
// button so users know at a glance whether a view is customised.
export function isDefaultTableSettings(settings: TableSettings, schema: ListSchemaLike): boolean {
  if (settings.groupBy !== null) return false;
  if (settings.subGroupBy !== null) return false;
  if (settings.orderBy !== null) return false;
  if (settings.orderDirection !== 'desc') return false;
  if (Object.keys(settings.columnWidths).length > 0) return false;
  const allKeys = schema.columns.map((c) => c.key);
  if (settings.visibleColumns.length !== allKeys.length) return false;
  const visible = new Set(settings.visibleColumns);
  for (const key of allKeys) if (!visible.has(key)) return false;
  return true;
}

// Clearing grouping also clears sub-grouping — a sub-grouping with
// no parent grouping is nonsensical.
export function setGroupBy(settings: TableSettings, key: string | null): TableSettings {
  if (key === null) {
    return { ...settings, groupBy: null, subGroupBy: null };
  }
  // Prevent the same column appearing in both slots.
  const sub = settings.subGroupBy === key ? null : settings.subGroupBy;
  return { ...settings, groupBy: key, subGroupBy: sub };
}

export function setSubGroupBy(settings: TableSettings, key: string | null): TableSettings {
  if (key !== null && key === settings.groupBy) return settings;
  return { ...settings, subGroupBy: key };
}
