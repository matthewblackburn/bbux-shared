import type { HTMLAttributes } from 'react';
import { useEffect, useState } from 'react';
import { cn } from '../../cn';

// RelativeTime renders "just now", "2 min ago", "yesterday" etc. via
// Intl.RelativeTimeFormat. Ticks every 60s so "2 min ago" becomes "3 min ago"
// without a reload — matters for last-synced indicators.
// Absolute value is always in a `title` attribute for hover-disambiguation.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function formatRelative(ms: number, locale: string): string {
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(ms);
  if (abs < MINUTE) return fmt.format(Math.round(ms / SECOND), 'second');
  if (abs < HOUR) return fmt.format(Math.round(ms / MINUTE), 'minute');
  if (abs < DAY) return fmt.format(Math.round(ms / HOUR), 'hour');
  if (abs < WEEK) return fmt.format(Math.round(ms / DAY), 'day');
  if (abs < MONTH) return fmt.format(Math.round(ms / WEEK), 'week');
  if (abs < YEAR) return fmt.format(Math.round(ms / MONTH), 'month');
  return fmt.format(Math.round(ms / YEAR), 'year');
}

export interface RelativeTimeProps extends HTMLAttributes<HTMLTimeElement> {
  value: Date | string | number | null | undefined;
  locale?: string;
}

export function RelativeTime({ value, locale = 'en-AU', className, ...props }: RelativeTimeProps) {
  // Tick every minute so "2 min ago" advances without a refresh.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), MINUTE);
    return () => clearInterval(t);
  }, []);

  if (value == null) {
    return <span className={cn('text-text-subtle', className)}>—</span>;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <span className={cn('text-text-subtle', className)}>—</span>;
  }
  const diff = date.getTime() - Date.now();
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString(locale)}
      className={cn(className)}
      {...props}
    >
      {formatRelative(diff, locale)}
    </time>
  );
}
