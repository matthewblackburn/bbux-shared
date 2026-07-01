import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { TableCell } from '../../table';
import { cn } from '../../cn';

// RefLinkCell renders edge-object values (single or array) as
// react-router <Link>s into the related entity's detail page. Used
// when a ref column's path resolves to one or more objects with an
// `id` field.
//
// Same overflow behaviour as TextCell.formatValue: ≤3 items render
// inline, beyond that the head + "+N more" hint appears at the end
// (the overflow itself isn't currently expandable — same as TextCell
// today).

const ARRAY_INLINE_LIMIT = 3;

export interface RefEntry {
  id: string;
  label: string;
  href: string;
}

export interface RefLinkCellProps {
  entries: RefEntry[];
  isFirst?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function RefLinkCell({ entries, isFirst, className, style }: RefLinkCellProps) {
  if (entries.length === 0) {
    return (
      <TableCell
        style={style}
        className={cn(
          'truncate whitespace-nowrap',
          isFirst ? 'font-medium' : 'text-muted-foreground',
          className,
        )}
      >
        —
      </TableCell>
    );
  }
  const head = entries.slice(0, ARRAY_INLINE_LIMIT);
  const overflow = entries.length - ARRAY_INLINE_LIMIT;
  // One-line cell: title carries the full list (without overflow
  // hint) so the user can hover to see the full list when the line
  // is truncated by the column width.
  const fullTitle = entries.map((e) => e.label).join(', ');
  return (
    <TableCell
      style={style}
      className={cn(
        'truncate whitespace-nowrap',
        isFirst ? 'font-medium' : 'text-muted-foreground',
        className,
      )}
      title={fullTitle}
    >
      {head.map((entry, idx) => (
        <span key={entry.id}>
          <Link
            to={entry.href}
            // stopPropagation so a future row-click handler doesn't
            // hijack the link click.
            onClick={(e) => e.stopPropagation()}
            className="hover:text-foreground hover:underline"
          >
            {entry.label}
          </Link>
          {idx < head.length - 1 ? <span className="text-muted-foreground">, </span> : null}
        </span>
      ))}
      {overflow > 0 ? <span className="text-muted-foreground"> +{overflow} more</span> : null}
    </TableCell>
  );
}
