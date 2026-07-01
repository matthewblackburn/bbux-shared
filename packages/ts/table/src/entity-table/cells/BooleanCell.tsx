import { Check, X } from 'lucide-react';
import { TableCell } from '../../table';
import { cn } from '../../cn';
import type { CellProps } from './index';

// BooleanCell — a boolean column (type "bool") rendered as an icon, not the raw
// "true"/"false" text: a green check when set, a muted X when not. Used for
// flags like "Deploy key set" / "Deploy token set".
export function BooleanCell({ value, className, style }: CellProps) {
  const on = value === true || value === 'true';
  return (
    <TableCell style={style} className={cn(className)}>
      {on ? (
        <Check className="size-4 text-success" aria-label="Yes" />
      ) : (
        <X className="size-4 text-text-subtle" aria-label="No" />
      )}
    </TableCell>
  );
}
