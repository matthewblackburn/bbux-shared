import { Badge } from '../badge';
import { statusVariant } from './status';

// The list's status chip. The status → colour mapping lives in `./status` so
// the detail-page status dot (StatusMenu) shares the exact same colour language.

export function StatusBadge({ status }: { status: string | undefined }) {
  // Null / undefined / empty render as a neutral em-dash so list
  // cells don't shout "unknown" for fields the source system left
  // unset (e.g. Quote.customer_stage on quotes that haven't been
  // through the customer-acceptance workflow yet).
  if (status == null || status === '') {
    return <span className="text-text-subtle">—</span>;
  }
  return <Badge variant={statusVariant(status)}>{status}</Badge>;
}
