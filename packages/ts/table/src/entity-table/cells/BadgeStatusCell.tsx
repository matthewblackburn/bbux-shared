import type { CSSProperties } from 'react';
import { TableCell } from '../../table';
import { StatusBadge } from '../StatusBadge';

// Status / enum / bool column rendered as a coloured badge. The
// underlying StatusBadge owns the colour mapping (active=success,
// pending=warning, etc.) — see entity-list/StatusBadge.tsx.
//
// String values render directly; boolean values are coerced to
// "true" / "false" so columns marked Kind=bool with raw boolean
// payloads still hit the right badge variant.
export interface BadgeStatusCellProps {
  value: unknown;
  className?: string;
  style?: CSSProperties;
}

export function BadgeStatusCell({ value, className, style }: BadgeStatusCellProps) {
  const str =
    typeof value === 'string' ? value : typeof value === 'boolean' ? String(value) : undefined;
  return (
    <TableCell className={className} style={style}>
      <StatusBadge status={str} />
    </TableCell>
  );
}
