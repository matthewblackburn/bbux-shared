import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TableCell } from '../../table';
import { cn } from '../../cn';

// Plain text cell — the catch-all renderer. Default for column.type
// "text" and the fallback when an unknown type slips through.
//
// Null / empty / non-string values render as an em-dash. The
// `isFirst` flag bumps the typographic weight on the leftmost
// column so the row's identity column reads as the headline.
//
// `children` lets callers compose extra content (badges, icons,
// trailing meta) without needing a separate cell component for
// every variation. Most callers won't pass it.
export interface TextCellProps {
  value: unknown;
  isFirst?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  // When set, the cell value is wrapped in a react-router <Link> to
  // this URL. Used by the table to make the pinned-left primary
  // cell navigate to the row's detail page.
  linkHref?: string;
}

export function TextCell({ value, isFirst, className, style, children, linkHref }: TextCellProps) {
  const display = formatValue(value);
  // Title carries the full untruncated text so users can hover for
  // the long version when the column width clips the visible text.
  const title = typeof children === 'undefined' ? display : undefined;
  const inner = children ?? display;
  return (
    <TableCell
      style={style}
      className={cn(
        'truncate whitespace-nowrap',
        isFirst ? 'font-medium' : 'text-muted-foreground',
        className,
      )}
      title={title}
    >
      {linkHref ? (
        <Link
          to={linkHref}
          // stopPropagation so a future row-level click handler
          // doesn't hijack the navigation.
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
    </TableCell>
  );
}

// Compact label for a Recipe array — used for M2M-reverse columns
// like Customer.Sites or Site.Contacts. Some customers have hundreds
// of related rows (one tenant has a customer with 1356 sites);
// joining all names produces a wall of text. Show the first few +
// "+N more" once the list crosses ARRAY_INLINE_LIMIT.
const ARRAY_INLINE_LIMIT = 3;

function formatValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    const labels = value.map((v) => (typeof v === 'string' ? v : String(v ?? '')));
    if (labels.length <= ARRAY_INLINE_LIMIT) return labels.join(', ');
    const head = labels.slice(0, ARRAY_INLINE_LIMIT).join(', ');
    return `${head} +${labels.length - ARRAY_INLINE_LIMIT} more`;
  }
  if (typeof value === 'string') return value;
  return String(value);
}
