import { Layers } from 'lucide-react';
import { TableCell } from '../../table';
import { cn } from '../../cn';
import type { CellProps } from './index';

// RepeaterSummaryCell — a repeater column (type "repeater-summary", cms-design/18)
// rendered as a compact "N items" count, not the raw array. The full sub-object
// rows are edited on the detail page; the list only needs the size.
export function RepeaterSummaryCell({ value, className, style }: CellProps) {
  const count = Array.isArray(value) ? value.length : 0;
  return (
    <TableCell style={style} className={cn('text-text-muted', className)}>
      {count === 0 ? (
        <span className="text-text-subtle">—</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <Layers className="size-3.5 text-text-subtle" aria-hidden />
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      )}
    </TableCell>
  );
}
