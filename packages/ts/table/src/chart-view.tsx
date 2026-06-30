import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from './chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import type { TableColumn } from './types';

// Value-distribution chart BODY. Designed to render inside @bbux/ui's
// ModalPanel — the consumer opens it via:
//
//   const { openModal } = useModals();
//   openModal(({ close }) => (
//     <ModalPanel title="Chart" onClose={close} bodyClassName="flex min-h-0 flex-col p-0">
//       <ChartView columns={columns} rows={rows} />
//     </ModalPanel>
//   ));
//
// ChartView does NOT open the modal itself and carries no Sheet/Dialog
// wrapper. It owns only its own padding (p-4) so it sits correctly in a
// p-0 modal body, plus a Measure / Slice control row, a recharts
// <BarChart>, and a Breakdown table.
//
// The chart runs over the CURRENT dataset passed in (`rows`). Numeric
// columns (sortType === 'numeric') are bucketed; text columns are
// counted by distinct value. The data is held entirely in memory — no
// server round-trips.

const MAX_TEXT_BARS = 12;
const NUMERIC_BUCKETS = 10;
const NO_VALUE_LABEL = '—';

const chartConfig = {
  count: { label: 'Count', color: 'var(--primary)' },
} satisfies ChartConfig;

export interface ChartViewProps {
  /** Columns the user can chart (typically the visible/known columns). */
  columns: TableColumn[];
  /** The current dataset (post per-column filters + sort). */
  rows: Record<string, string>[];
}

interface Datum {
  label: string;
  count: number;
}

export function ChartView({ columns, rows }: ChartViewProps) {
  const [columnId, setColumnId] = useState<string | null>(() => columns[0]?.id ?? null);

  const column = useMemo(() => columns.find((c) => c.id === columnId) ?? null, [columns, columnId]);

  const numeric = column ? column.sortType === 'numeric' : false;

  const data = useMemo<Datum[]>(() => {
    if (!column) return [];
    return numeric ? bucketNumeric(rows, column.label) : countDistinct(rows, column.label);
  }, [column, numeric, rows]);

  const hasData = data.some((d) => d.count > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" data-testid="chart-view">
      <p className="mb-4 text-muted-foreground text-sm">
        Counts across the {new Intl.NumberFormat('en-AU').format(rows.length)} rows.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <DropdownField
          label="Measure"
          value="count"
          options={[{ value: 'count', label: 'Count' }]}
        />
        <DropdownField
          label="Slice"
          value={columnId ?? ''}
          onChange={(v) => setColumnId(v || null)}
          options={columns.map((c) => ({ value: c.id, label: c.label }))}
          testid="chart-view-column"
        />
      </div>

      {hasData ? (
        <>
          <Bars data={data} />
          <Breakdown label={column?.label ?? ''} data={data} />
        </>
      ) : (
        <div className="rounded-md border border-border border-dashed px-4 py-12 text-center text-muted-foreground text-sm">
          No data to chart for this column.
        </div>
      )}
    </div>
  );
}

// recharts bar chart: ChartContainer (aspect-[4/3]) → BarChart with a
// faint grid, X/Y axes, a cursor-less tooltip, and a rounded Bar
// carrying a count LabelList. The bar fill reads `--color-count`
// (--primary) injected by ChartContainer.
function Bars({ data }: { data: Datum[] }) {
  const dense = data.length > 6;
  return (
    <div className="mb-4">
      <ChartContainer config={chartConfig} className="aspect-[4/3] w-full">
        <BarChart accessibilityLayer data={data} margin={{ top: 20, right: 4, left: 4, bottom: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            interval={0}
            height={dense ? 0 : 28}
            tick={dense ? false : { fontSize: 10 }}
            tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 14)}…` : v)}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={28}
            tick={{ fontSize: 10 }}
          />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel={false} />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="var(--color-count)">
            <LabelList
              dataKey="count"
              position="top"
              className="fill-muted-foreground"
              fontSize={10}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function Breakdown({ label, data }: { label: string; data: Datum[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border" data-testid="chart-view-breakdown">
      <div className="grid grid-cols-[1fr_auto] items-center border-border border-b px-3 py-2 font-medium text-muted-foreground text-xs">
        <div className="truncate">{label}</div>
        <div className="tabular-nums">Count</div>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {data.map((d) => (
          <div
            key={d.label}
            className="grid grid-cols-[1fr_auto] items-center border-border border-b px-3 py-1.5 text-sm last:border-0"
            data-testid="chart-view-bar"
            data-label={d.label}
            data-count={d.count}
          >
            <div className="truncate text-foreground">{d.label}</div>
            <div className="text-foreground tabular-nums">{d.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Small label over an h-8 full-width SelectTrigger. "Measure" is fixed
// to Count; "Slice" picks the column.
function DropdownField({
  label,
  value,
  onChange,
  options,
  testid,
}: {
  label: string;
  value: string;
  onChange?: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  testid?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-muted-foreground text-xs">{label}</span> : null}
      <Select
        value={value || '__none__'}
        onValueChange={(v) => onChange?.(v === '__none__' ? '' : v)}
        disabled={!onChange || options.length <= 1}
      >
        <SelectTrigger className="h-8 w-full" data-testid={testid}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value || '__none__'} value={o.value || '__none__'}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Bucketing helpers (pure — exported for unit tests) ─────────────

/**
 * Count distinct string values of `field` across `rows`, sorted by
 * count desc. Only the top MAX_TEXT_BARS distinct values are kept; the
 * remainder folds into a trailing "Other" row so the chart stays
 * readable for high-cardinality columns.
 */
export function countDistinct(rows: ReadonlyArray<Record<string, unknown>>, field: string): Datum[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = String(row[field] ?? '').trim();
    const key = raw === '' ? NO_VALUE_LABEL : raw;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
  if (sorted.length <= MAX_TEXT_BARS) return sorted;
  const top = sorted.slice(0, MAX_TEXT_BARS);
  const otherCount = sorted.slice(MAX_TEXT_BARS).reduce((n, d) => n + d.count, 0);
  return otherCount > 0 ? [...top, { label: 'Other', count: otherCount }] : top;
}

/**
 * Bucket numeric `field` values into NUMERIC_BUCKETS equal-width
 * buckets across [min, max]. Returns one Datum per bucket with a
 * "$lo–$hi" label. When every value is equal (or there's one value),
 * returns a single bucket so the chart still renders.
 */
export function bucketNumeric(rows: ReadonlyArray<Record<string, unknown>>, field: string): Datum[] {
  const values = rows.map((r) => parseNumeric(r[field])).filter((n) => Number.isFinite(n));
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ label: fmtMoney(min), count: values.length }];
  }
  const width = (max - min) / NUMERIC_BUCKETS;
  const buckets: Datum[] = Array.from({ length: NUMERIC_BUCKETS }, (_, i) => {
    const lo = min + i * width;
    const hi = i === NUMERIC_BUCKETS - 1 ? max : min + (i + 1) * width;
    return { label: `${fmtMoney(lo)}–${fmtMoney(hi)}`, count: 0 };
  });
  for (const v of values) {
    // Clamp the index so the max value lands in the last bucket.
    let idx = Math.floor((v - min) / width);
    if (idx >= NUMERIC_BUCKETS) idx = NUMERIC_BUCKETS - 1;
    if (idx < 0) idx = 0;
    buckets[idx].count += 1;
  }
  return buckets;
}

// Parse a possibly-formatted numeric/currency cell ("$1,234.50") into a
// number. Strips everything but digits, sign, and the decimal point.
// Returns NaN for empty / non-numeric cells so bucketNumeric drops them.
function parseNumeric(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '').replace(/[^0-9.-]/g, '');
  if (s === '' || s === '-' || s === '.') return Number.NaN;
  return Number.parseFloat(s);
}

function fmtMoney(n: number): string {
  return `$${new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(Math.round(n))}`;
}
