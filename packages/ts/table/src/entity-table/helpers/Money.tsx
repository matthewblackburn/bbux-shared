import type { HTMLAttributes } from 'react';
import { cn } from '../../cn';

// Money renders a number as a currency string via Intl.NumberFormat.
// Defaults: AUD (CLAUDE.md says single-business trades, AU). Pass
// `currency` or `locale` to override for one-offs (e.g. supplier invoices
// in USD). Falls back to "—" for null/undefined.
//
// Amount is in major units (dollars), not cents — consistent with how
// ent's numeric fields will serialize. Let the component round-trip the
// value; don't pre-format upstream.

export interface MoneyProps extends HTMLAttributes<HTMLSpanElement> {
  amount: number | null | undefined;
  currency?: string;
  locale?: string;
  /** `true` to hide the currency code (just "$42,180.00"). Default true. */
  symbolOnly?: boolean;
}

export function Money({
  amount,
  currency = 'AUD',
  locale = 'en-AU',
  symbolOnly = true,
  className,
  ...props
}: MoneyProps) {
  if (amount == null) {
    return (
      <span className={cn('text-text-subtle', className)} {...props}>
        —
      </span>
    );
  }
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: symbolOnly ? 'narrowSymbol' : 'code',
  });
  return (
    <span className={cn('tabular-nums', className)} {...props}>
      {formatter.format(amount)}
    </span>
  );
}
