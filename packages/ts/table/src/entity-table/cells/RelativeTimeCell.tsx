import type { CSSProperties } from 'react';
import { RelativeTime } from '../helpers/RelativeTime';
import { TableCell } from '../../table';
import { cn } from '../../cn';

// Timestamp shown as "3 hours ago" with the absolute datetime in a
// hover tooltip. RelativeTime handles formatting + null fallback.
//
// Always rendered in muted grey because timestamp columns are meta
// data — never the row's headline.
export interface RelativeTimeCellProps {
  value: unknown;
  className?: string;
  style?: CSSProperties;
}

export function RelativeTimeCell({ value, className, style }: RelativeTimeCellProps) {
  const v = typeof value === 'string' || typeof value === 'number' ? value : undefined;
  return (
    <TableCell style={style} className={cn('text-muted-foreground', className)}>
      <RelativeTime value={v} />
    </TableCell>
  );
}
