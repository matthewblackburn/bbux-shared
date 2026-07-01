import { Lock } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Badge } from '../../badge';
import { TableCell } from '../../table';

// InheritedCell renders the read-only `inherited` flag on reference entities:
// an "Inherited" badge (with a lock) when the row belongs to a parent account
// (shared/read-only here), and nothing for the account's own rows. Makes it
// obvious in the list which rows are central reference data.
export interface InheritedCellProps {
  value: unknown;
  className?: string;
  style?: CSSProperties;
}

export function InheritedCell({ value, className, style }: InheritedCellProps) {
  return (
    <TableCell className={className} style={style}>
      {value === true ? (
        <Badge variant="secondary" className="gap-1 font-normal text-text-muted">
          <Lock className="size-3" aria-hidden />
          Inherited
        </Badge>
      ) : (
        <span className="text-text-subtle">—</span>
      )}
    </TableCell>
  );
}
