// Generic column descriptor the @bbux/table components operate on.
//
// Deliberately decoupled from any app's row schema (tcms's SOWCode,
// bbux's GraphQL list schema). Consumers map their own column model
// onto this shape before handing columns to FilterPopover /
// DisplayOptions / ChartView.
export interface TableColumn {
  /** Stable, URL-safe id (e.g. 'sow-code'). Used as the toggle/select key. */
  id: string;
  /** Human-readable label shown in pills, selects, and the chart. */
  label: string;
  /**
   * 'numeric' columns are bucketed in the chart and treated as ranges;
   * 'text' columns are counted by distinct value.
   */
  sortType: 'numeric' | 'text';
  /** True when this column accepts a free-text "contains" filter. */
  textFilterable: boolean;
  /**
   * Pinned-left columns are locked visible in DisplayOptions — they
   * render as an always-on, non-toggleable pill.
   */
  pinnedLeft?: boolean;
}

/** Current sort applied to the table — column id + direction. */
export interface TableSort {
  column: string;
  direction: 'asc' | 'desc';
}
