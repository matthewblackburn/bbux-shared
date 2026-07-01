import type { FilterValue } from './filter-types';

// Column-grid schema types shared by the EntityTable (@bbux/table) and its
// consumers. Ported from bbux's tygo-generated bootstrap types so the shared
// table doesn't depend on any one app's generated types.

export interface Column {
  key: string;
  label: string;
  type: string;
  sortable?: boolean;
  kind?: string;
  filter_key?: string;
  values?: FilterValue[];
  distinct_path?: string;
  icon?: string;
  color?: string;
  pinned?: string;
  /**
   * Primary (frontend-only): the column the row's detail link attaches to (the
   * clickable identity cell). Unset → the link falls back to the pinned/first
   * column.
   */
  primary?: boolean;
  /**
   * RefListField (frontend-only): when present the list cell renders the value's
   * {id,label} as a link to /<refListField>/<id>.
   */
  refListField?: string;
}

export interface Measure {
  key: string;
  label: string;
  type: string;
  aggregations: string[];
  source_column: string;
  icon?: string;
  color?: string;
}

/** The column-based grid schema the EntityTable renders. */
export interface ListSchema {
  columns: Column[];
  measures?: Measure[];
}
