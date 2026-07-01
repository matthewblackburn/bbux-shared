import type { CSSProperties } from 'react';
import { TableCell } from '../../table';
import { cn } from '../../cn';

// Person reference (Contact, Employee, Contractor) rendered as
// "Given Family". Both names are optional in Simpro — falls back
// to em-dash when both are missing.
//
// Expected shape: { given_name?: string; family_name?: string }.
// When an entity exposes a person via an FK, the API includes the
// related Contact/Employee/Contractor row inline on the JSON
// response, and this cell pulls the two name fields off it.
export interface PersonNameCellProps {
  value: unknown;
  isFirst?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PersonNameCell({ value, isFirst, className, style }: PersonNameCellProps) {
  const person = value as { given_name?: string; family_name?: string } | undefined;
  const parts = [person?.given_name, person?.family_name].filter(Boolean);
  const display = parts.length > 0 ? parts.join(' ') : '—';
  return (
    <TableCell
      style={style}
      className={cn(
        'truncate whitespace-nowrap',
        isFirst ? 'font-medium' : 'text-muted-foreground',
        className,
      )}
    >
      {display}
    </TableCell>
  );
}
