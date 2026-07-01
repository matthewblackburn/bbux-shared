import type { CSSProperties } from 'react';
import { TableCell } from '../../table';
import { cn } from '../../cn';
import { resolveFilterColor, resolveIcon } from '../SchemaRender';

interface CellProps {
  value: unknown;
  className?: string;
  style?: CSSProperties;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ColorCell renders a colour value (a token like "violet") as a filled dot +
// label, instead of raw text. The dot uses bg-current on the token's text-colour
// class (resolveFilterColor).
export function ColorCell({ value, className, style }: CellProps) {
  const token = typeof value === 'string' ? value : '';
  return (
    <TableCell className={className} style={style}>
      {token ? (
        <span className="inline-flex items-center gap-2">
          <span className={cn('size-3.5 rounded-full bg-current', resolveFilterColor(token))} />
          <span className="text-text-muted">{cap(token)}</span>
        </span>
      ) : (
        <span className="text-text-subtle">—</span>
      )}
    </TableCell>
  );
}

// IconCell renders an icon value (a lucide name) as the actual glyph.
export function IconCell({ value, className, style }: CellProps) {
  const name = typeof value === 'string' ? value : '';
  const Icon = name ? resolveIcon(name) : null;
  return (
    <TableCell className={className} style={style}>
      {Icon ? (
        <Icon className="size-4 text-text-muted" aria-label={name} />
      ) : (
        <span className="text-text-subtle">—</span>
      )}
    </TableCell>
  );
}
