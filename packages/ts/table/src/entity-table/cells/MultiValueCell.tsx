import type { CSSProperties } from 'react';
import { Badge } from '../../badge';
import { TableCell } from '../../table';

// MultiValueCell renders an M2M / multi-value array (e.g. a user's roles, tags)
// as a row of neutral chips. A scalar value renders as a single chip; an empty
// value renders the standard placeholder. The matching enum filter (kind:'enum'
// on the column) treats the array as a membership set — see client-data.ts.
export interface MultiValueCellProps {
  value: unknown;
  className?: string;
  style?: CSSProperties;
}

export function MultiValueCell({ value, className, style }: MultiValueCellProps) {
  const items = Array.isArray(value) ? value : value != null && value !== '' ? [value] : [];
  return (
    <TableCell className={className} style={style}>
      {items.length === 0 ? (
        <span className="text-text-subtle">—</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((v) => (
            <Badge key={String(v)} variant="secondary" className="font-normal">
              {String(v)}
            </Badge>
          ))}
        </div>
      )}
    </TableCell>
  );
}
