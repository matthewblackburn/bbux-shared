import type { CSSProperties } from 'react';
import { Money } from '../helpers/Money';
import { TableCell } from '../../table';
import { cn } from '../../cn';

// Currency amount, right-aligned, tabular nums. Wraps the shared
// `Money` formatter (en-AU / AUD by default per CLAUDE.md). When
// accounting integration lands and per-row currencies appear, the
// underlying Money component already accepts a `currency` prop —
// this cell just needs to forward it.
//
// Right-alignment matters: numeric columns scan vertically, so the
// decimal point stays in the same horizontal position regardless
// of magnitude. tabular-nums keeps the digits the same width.
export interface CurrencyCellProps {
  value: unknown;
  isFirst?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function CurrencyCell({ value, isFirst, className, style }: CurrencyCellProps) {
  const amount =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : null;
  const safe = Number.isFinite(amount) ? amount : null;
  return (
    <TableCell
      style={style}
      className={cn(
        'truncate whitespace-nowrap',
        isFirst ? 'font-medium' : 'text-muted-foreground',
        'text-right tabular-nums',
        className,
      )}
    >
      <Money amount={safe} />
    </TableCell>
  );
}
