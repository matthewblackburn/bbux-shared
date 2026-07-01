import type { FilterField } from '@bbux/types';
import { CalendarRange, Loader2, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from './chart';
import { cn } from './cn';
import { Input } from './input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import type { TableColumn } from './types';

// Value-distribution chart BODY — the superset of tcms's in-memory
// bucket/distinct chart and bbux's server-count enum-slice chart
// (apps/web/src/components/entity-list/ChartPanel.tsx).
//
// Designed to render inside @bbux/ui's ModalPanel — the consumer opens
// it via:
//
//   const { openModal } = useModals();
//   openModal(({ close }) => (
//     <ModalPanel title="Chart" onClose={close} bodyClassName="flex min-h-0 flex-col p-0">
//       <ChartView columns={columns} rows={rows} />   // client mode
//     </ModalPanel>
//   ));
//
// ChartView does NOT open the modal itself and carries no Sheet/Dialog
// wrapper. It owns only its own padding (p-4).
//
// Two modes, discriminated on `mode`:
//
//   mode: 'client' (tcms) — { columns, rows }
//     Charts the CURRENT in-memory dataset. Numeric columns
//     (sortType === 'numeric') are bucketed; text columns are counted
//     by distinct value. No server round-trips. This is the DEFAULT
//     when `mode` is omitted (so `<ChartView columns rows />` keeps
//     working unchanged).
//
//   mode: 'count' (bbux) — { filterFields, count, baseWhere?, dateFields?, … }
//     bbux's ChartPanel behaviour, faithfully: charts an ENUM-slice
//     distribution by running the injected `count(where) => Promise<number>`
//     once per enum value of the chosen slice, with the table's current
//     filters + an optional date range merged in. The bar colour comes from
//     the slice's icon colour (colorVarFromTextClass) and the breakdown
//     header shows the slice icon — matching the app original.
//     Data-source-agnostic: the caller owns the query. High-cardinality
//     (non-enum) fields aren't sliceable.

const MAX_TEXT_BARS = 12;
const NUMERIC_BUCKETS = 10;
const NO_VALUE_LABEL = '—';

/** CLIENT mode — bucket/distinct over an in-memory dataset (tcms). */
export interface ChartViewClientProps {
  mode?: 'client';
  /** Columns the user can chart (typically the visible/known columns). */
  columns: TableColumn[];
  /** The current dataset (post per-column filters + sort). */
  rows: Record<string, string>[];
}

/** A datetime dimension the count-mode date-range control can filter by. */
export interface ChartDateField {
  /** Field key used as the `where` key for the date range. */
  key: string;
  label: string;
}

/** COUNT mode — enum-slice distribution via a count callback (bbux). */
export interface ChartViewCountProps {
  mode: 'count';
  /** Filter fields; the static (enum) ones become sliceable dimensions. */
  filterFields: ReadonlyArray<FilterField>;
  /** Runs a count for an arbitrary `where` — provided by the consumer,
   *  which owns the data client (GraphQL, REST, …). */
  count: (where: Record<string, unknown>) => Promise<number>;
  /** The table's current filters, merged into every count `where`. */
  baseWhere?: Record<string, unknown>;
  /** Optional datetime dimensions for the date-range control. Supply
   *  these directly — the package does not depend on any list schema. */
  dateFields?: ReadonlyArray<ChartDateField>;
  /** Part of the query cache key so counts refetch on scope change. */
  scopeKey?: string;
  /** Async count runner. Callers using React Query can pass a memoised
   *  wrapper; the default runs the counts with a plain useEffect. */
  runCounts?: RunCounts;
}

export type ChartViewProps = ChartViewClientProps | ChartViewCountProps;

interface Datum {
  label: string;
  count: number;
  value?: string;
}

export function ChartView(props: ChartViewProps) {
  if (props.mode === 'count') return <CountChartView {...props} />;
  return <ClientChartView {...props} />;
}

// ── CLIENT mode ────────────────────────────────────────────────────

function ClientChartView({ columns, rows }: ChartViewClientProps) {
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
      <p className="mb-4 text-sm text-text-muted">
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
          <Bars data={data} color="var(--primary)" />
          <Breakdown label={column?.label ?? ''} data={data} />
        </>
      ) : (
        <div className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-text-muted">
          No data to chart for this column.
        </div>
      )}
    </div>
  );
}

// ── COUNT mode ─────────────────────────────────────────────────────

interface SliceOption {
  key: string;
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  values: ReadonlyArray<{ value: string; label: string }>;
}

// Enum filter fields (kind === 'static' with inline values) are the
// sliceable dimensions — their finite value set is exactly what we count
// over.
function sliceOptionFor(f: FilterField): SliceOption | null {
  if (f.kind !== 'static' || !f.values?.length) return null;
  return {
    key: f.key,
    label: f.label,
    icon: f.icon,
    iconClassName: f.iconClassName,
    values: f.values.map((v) => ({ value: v.value, label: v.label })),
  };
}

/** Injected async runner so consumers can back the counts with their own
 *  cache (e.g. React Query). Given the cache key + a thunk that resolves
 *  the datums, it returns the current async state. Defaults to a plain
 *  useEffect-based runner (no external cache). */
export type RunCounts = (
  key: string,
  run: () => Promise<Datum[]>,
) => { data: Datum[] | undefined; isLoading: boolean; error: boolean };

const defaultRunCounts: RunCounts = (key, run) => {
  const [data, setData] = useState<Datum[] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  // key is intentionally the only dep — `run` closes over the same
  // inputs the key encodes, so keying on it avoids stale-closure refetch
  // storms while still refetching when the slice/filters/date change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(false);
    run()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return { data, isLoading, error };
};

function CountChartView({
  filterFields,
  count,
  baseWhere,
  dateFields = [],
  scopeKey,
  runCounts,
}: ChartViewCountProps) {
  const sliceOptions = useMemo(
    () => filterFields.map(sliceOptionFor).filter((o): o is SliceOption => o !== null),
    [filterFields],
  );

  const [sliceKey, setSliceKey] = useState<string | null>(() => sliceOptions[0]?.key ?? null);
  const [dateField, setDateField] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Default the slice once options are known.
  useEffect(() => {
    if (sliceKey === null && sliceOptions.length > 0) setSliceKey(sliceOptions[0].key);
  }, [sliceKey, sliceOptions]);

  const slice = sliceOptions.find((s) => s.key === sliceKey) ?? null;

  const dateWhere = useMemo<Record<string, unknown>>(() => {
    if (!dateField || (!from && !to)) return {};
    const range: Record<string, string> = {};
    if (from) range.gte = new Date(`${from}T00:00:00`).toISOString();
    if (to) range.lte = new Date(`${to}T23:59:59`).toISOString();
    return { [dateField]: range };
  }, [dateField, from, to]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" data-testid="chart-view">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <DropdownField
          label="Measure"
          value="count"
          options={[{ value: 'count', label: 'Count' }]}
        />
        <DropdownField
          label="Slice"
          value={sliceKey ?? ''}
          onChange={(v) => setSliceKey(v || null)}
          options={sliceOptions.map((s) => ({ value: s.key, label: s.label }))}
          disabled={sliceOptions.length === 0}
          testid="chart-view-column"
        />
      </div>

      {dateFields.length > 0 ? (
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <CalendarRange className="size-3.5" /> Date range
          </div>
          <DropdownField
            label=""
            value={dateField}
            onChange={setDateField}
            options={[
              { value: '', label: 'No date filter' },
              ...dateFields.map((d) => ({ value: d.key, label: d.label })),
            ]}
            testid="chart-view-date-field"
          />
          {dateField ? (
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={from}
                max={to || undefined}
                data-testid="chart-view-date-from"
                onChange={(e) => setFrom(e.target.value)}
              />
              <Input
                type="date"
                value={to}
                min={from || undefined}
                data-testid="chart-view-date-to"
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {slice ? (
        <SliceChart
          slice={slice}
          count={count}
          baseWhere={baseWhere ?? {}}
          dateWhere={dateWhere}
          scopeKey={scopeKey}
          runCounts={runCounts ?? defaultRunCounts}
        />
      ) : (
        <div
          className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-text-muted"
          data-testid="chart-view-empty"
        >
          Pick a slice to chart this view.
        </div>
      )}
    </div>
  );
}

function SliceChart({
  slice,
  count,
  baseWhere,
  dateWhere,
  scopeKey,
  runCounts,
}: {
  slice: SliceOption;
  count: (where: Record<string, unknown>) => Promise<number>;
  baseWhere: Record<string, unknown>;
  dateWhere: Record<string, unknown>;
  scopeKey?: string;
  runCounts: RunCounts;
}) {
  const key = JSON.stringify({ scope: scopeKey, s: slice.key, b: baseWhere, d: dateWhere });
  const { data, isLoading, error } = runCounts(key, async () => {
    const rows = await Promise.all(
      slice.values.map(async (v) => ({
        value: v.value,
        label: v.label,
        count: await count({ ...baseWhere, ...dateWhere, [slice.key]: { eq: v.value } }),
      })),
    );
    return rows.sort((a, b) => b.count - a.count);
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-text-muted"
        data-testid="chart-view-empty"
      >
        Failed to load chart data.
      </div>
    );
  }
  const values = data ?? [];
  if (values.every((v) => v.count === 0)) {
    return (
      <div
        className="rounded-md border border-dashed border-border px-4 py-12 text-center text-sm text-text-muted"
        data-testid="chart-view-empty"
      >
        No data for this slice.
      </div>
    );
  }

  return (
    <>
      <Bars data={values} color={colorVarFromTextClass(slice.iconClassName)} />
      <Breakdown label={slice.label} data={values} icon={slice.icon} iconClassName={slice.iconClassName} />
    </>
  );
}

// ── Shared chart pieces ────────────────────────────────────────────

// recharts bar chart: ChartContainer (aspect-[4/3]) → BarChart with a
// faint grid, X/Y axes, a cursor-less tooltip, and a rounded Bar
// carrying a count LabelList. `color` is injected as `--color-count` by
// ChartContainer and read by the Bar's fill — count mode passes the
// slice's icon colour (so bars match the filter icon), client mode
// passes --primary.
function Bars({ data, color }: { data: Datum[]; color: string }) {
  const chartConfig = { count: { label: 'Count', color } } satisfies ChartConfig;
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
            <LabelList dataKey="count" position="top" className="fill-text-muted" fontSize={10} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}

function Breakdown({
  label,
  data,
  icon: Icon,
  iconClassName,
}: {
  label: string;
  data: Datum[];
  icon?: LucideIcon;
  iconClassName?: string;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border" data-testid="chart-view-breakdown">
      <div className="grid grid-cols-[1fr_auto] items-center border-b border-border px-3 py-2 text-xs font-medium text-text-muted">
        {Icon ? (
          <div className="inline-flex items-center gap-1.5">
            <Icon className={cn('size-3.5', iconClassName)} />
            {label}
          </div>
        ) : (
          <div className="truncate">{label}</div>
        )}
        <div className="tabular-nums">Count</div>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {data.map((d) => (
          <div
            key={d.value ?? d.label}
            className="grid grid-cols-[1fr_auto] items-center border-b border-border px-3 py-1.5 text-sm last:border-0"
            data-testid="chart-view-bar"
            data-label={d.label}
            data-count={d.count}
          >
            <div className="truncate text-text">{d.label}</div>
            <div className="tabular-nums text-text">{d.count}</div>
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
  disabled,
  testid,
}: {
  label: string;
  value: string;
  onChange?: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  testid?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-xs text-text-muted">{label}</span> : null}
      <Select
        value={value || '__none__'}
        onValueChange={(v) => onChange?.(v === '__none__' ? '' : v)}
        disabled={disabled || !onChange || options.length <= 1}
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

// Map a filter text-color utility class ("text-amber") to the matching CSS
// variable recharts' fill can consume, so the count-mode bars match the
// filter icon colour. Falls back to --primary for any class we don't
// declare. Copied from bbux's ChartPanel.
function colorVarFromTextClass(textClass: string): string {
  const token = textClass.startsWith('text-') ? textClass.slice('text-'.length) : textClass;
  const map: Record<string, string> = {
    'text-muted': 'var(--text-muted)',
    primary: 'var(--primary)',
    info: 'var(--info)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--danger)',
    purple: 'var(--purple)',
    pink: 'var(--pink)',
    cyan: 'var(--cyan)',
    teal: 'var(--teal)',
    indigo: 'var(--indigo)',
    lime: 'var(--lime)',
    rose: 'var(--rose)',
    fuchsia: 'var(--fuchsia)',
    sky: 'var(--sky)',
    emerald: 'var(--emerald)',
    violet: 'var(--violet)',
    orange: 'var(--orange)',
    amber: 'var(--amber)',
  };
  return map[token] ?? 'var(--primary)';
}
