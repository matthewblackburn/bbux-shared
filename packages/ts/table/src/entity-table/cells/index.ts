// Cell catalogue — every entity-list column type maps to one of
// these components. The dispatcher in schema-render.tsx picks the
// right one based on the server's Column.type string.
//
// Hard rule: every cell renders a <TableCell>. Don't return raw
// strings or fragments; the table grid relies on TableCell for
// borders, padding, and alignment.
//
// Adding a new cell type:
//
//   1. Add a Column.type value in apps/api/internal/bootstrap/types.go
//      (so the type round-trips through tygo).
//   2. Build the cell here (one file per type, named <Type>Cell.tsx).
//   3. Wire it into the CELL_REGISTRY below.
//   4. Use the new type in apps/api/internal/bootstrap/schemas.go on
//      the columns that should render with it.
//
// Cells are designed to also work outside list views — detail-page
// "fact" rows, modals, summary cards. Just render <FooCell value=…/>
// inside any <Table><TableBody><TableRow>.
//
// Future cells we'll likely want — not yet implemented:
//   - EmailCell      mailto link + truncate
//   - PhoneCell      tel link, locale formatting
//   - UrlCell        click-through, strip protocol on display
//   - BooleanCell    plain Yes/No without colour weight
//   - NumberCell     non-currency numeric, tabular-nums
//   - PercentCell    0.42 → "42%"
//   - HexColorCell   "#0066ff" + a swatch (for Status/Tag colours)
//   - IdCell         simpro_id / internal_id, monospace
//   - MultiValueCell M2M arrays (technicians, tags) as chips
//   - DurationCell   Days/Hours/Minutes split (Job.response_time)
//   - RefLinkCell    FK ref that click-throughs to detail page
//   - JSONExpandCell JSON archive collapsed → expand on click

import type { ComponentType } from 'react';
import { BadgeStatusCell } from './BadgeStatusCell';
import { BooleanCell } from './BooleanCell';
import { CurrencyCell } from './CurrencyCell';
import { InheritedCell } from './InheritedCell';
import { MultiValueCell } from './MultiValueCell';
import { PersonNameCell } from './PersonNameCell';
import { RelativeTimeCell } from './RelativeTimeCell';
import { RepeaterSummaryCell } from './RepeaterSummaryCell';
import { ColorCell, IconCell } from './SwatchCells';
import { TextCell } from './TextCell';

// NOTE: the app-data-coupled cells (EntityTypeCell → useBootstrap,
// MediaTileCell → media api, UrlCell → useBootstrap) intentionally do NOT
// ship in this shared package — they pulled bbux's data layer in. Consumers
// that need them register their own via EntityTable's `cellRegistry` prop
// (see entity-table's cellRegistry merge). tcms needs none of them.
export {
  BadgeStatusCell,
  BooleanCell,
  ColorCell,
  CurrencyCell,
  IconCell,
  MultiValueCell,
  PersonNameCell,
  RelativeTimeCell,
  RepeaterSummaryCell,
  TextCell,
};

// Common shape every cell accepts. Individual cells consume only the
// props they need; React ignores extras.
//
// `className` / `style` are passthroughs that the table dispatcher
// uses to apply per-column layout (e.g. `position: sticky` for pinned
// columns) without each cell having to know about pinning. Cells
// merge these onto the underlying TableCell.
export interface CellProps {
  value: unknown;
  isFirst?: boolean;
  className?: string;
  style?: React.CSSProperties;
  // Optional link target. The pinned-left primary cell receives
  // this from the table dispatcher so the row's identity column
  // navigates to its detail page. Cells that don't render text
  // links ignore it.
  linkHref?: string;
}

// CELL_REGISTRY maps Column.type strings to cell components. The
// dispatcher (schema-render.tsx renderCell) looks up by type and
// falls back to TextCell for anything not in here, with a one-time
// console warning in dev so unknown types don't go silent.
export const CELL_REGISTRY: Record<string, ComponentType<CellProps>> = {
  text: TextCell,
  boolean: BooleanCell,
  'badge-status': BadgeStatusCell,
  'relative-time': RelativeTimeCell,
  'person-name': PersonNameCell,
  'multi-value': MultiValueCell,
  color: ColorCell,
  icon: IconCell,
  currency: CurrencyCell,
  'inherited-badge': InheritedCell,
  'repeater-summary': RepeaterSummaryCell,
  // 'url', 'entity-type', 'media-tile' are consumer-injected (see note above).
};
