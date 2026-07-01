import { ArrowDownUp } from 'lucide-react';
import { cn } from './cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import type { TableColumn, TableSort } from './types';

// Display-options popover BODY: a top section of setting rows
// (Grouping / Sub-grouping / Ordering), a separator, a "Display
// properties" section of toggle pills (one per column), a separator,
// and a Reset footer. The Popover wrapper stays in the consumer's
// toolbar. Pinned-left columns render locked-visible (disabled pill).

const NO_GROUPING = '__none__';

export interface DisplayOptionsProps {
  /** All columns the table can show / group / order by. Also the
   *  visibility-pill set unless `groupableColumns` narrows grouping. */
  columns: TableColumn[];
  /** Currently hidden column ids. */
  hidden: readonly string[];
  onHiddenChange: (hidden: string[]) => void;
  /** Group-by column id (or null for no grouping). */
  groupBy: string | null;
  subGroupBy: string | null;
  onGroupByChange: (colId: string | null) => void;
  onSubGroupByChange: (colId: string | null) => void;
  /** Current sort, plus setters. */
  sort: TableSort | null;
  onOrderByChange: (colId: string | null) => void;
  onToggleOrderDirection: () => void;
  /** Reset hidden cols + grouping + ordering to defaults. */
  onReset: () => void;
  /**
   * Optional: columns eligible for Grouping / Sub-grouping. Defaults to
   * `columns`. bbux passes only enum-ish columns here (grouping a
   * free-text column is meaningless) while still showing every column
   * as a visibility pill. tcms omits it → every column is groupable, as
   * before.
   */
  groupableColumns?: TableColumn[];
  /**
   * Optional: columns eligible for Ordering. Defaults to `columns`.
   * Same rationale as `groupableColumns` — a consumer can restrict the
   * sort dropdown without changing the visibility pills.
   */
  orderableColumns?: TableColumn[];
  /**
   * Optional: when false, the Reset button renders muted/disabled to
   * signal the view is already at defaults (bbux's dirty-state). tcms
   * omits it → Reset is always enabled, as before.
   */
  isDirty?: boolean;
}

export function DisplayOptions({
  columns,
  hidden,
  onHiddenChange,
  groupBy,
  subGroupBy,
  onGroupByChange,
  onSubGroupByChange,
  sort,
  onOrderByChange,
  onToggleOrderDirection,
  onReset,
  groupableColumns,
  orderableColumns,
  isDirty,
}: DisplayOptionsProps) {
  const groupCols = groupableColumns ?? columns;
  const orderCols = orderableColumns ?? columns;
  const hiddenSet = new Set(hidden);
  function toggle(colId: string) {
    const next = hiddenSet.has(colId)
      ? hidden.filter((id) => id !== colId)
      : [...hidden.filter((id) => id !== colId), colId];
    onHiddenChange(next);
  }
  const direction = sort?.direction ?? 'asc';
  return (
    <>
      <div className="space-y-3 p-3">
        <SettingRow label="Grouping">
          <GroupSelect
            value={groupBy}
            columns={groupCols}
            onChange={onGroupByChange}
            placeholder="No grouping"
            noneLabel="No grouping"
            testid="table-group-select"
          />
        </SettingRow>
        {groupBy !== null ? (
          <SettingRow label="Sub-grouping">
            <GroupSelect
              value={subGroupBy}
              columns={groupCols.filter((c) => c.id !== groupBy)}
              onChange={onSubGroupByChange}
              placeholder="No grouping"
              noneLabel="No grouping"
              testid="table-subgroup-select"
            />
          </SettingRow>
        ) : null}
        <SettingRow label="Ordering">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={`Sort ${direction === 'asc' ? 'descending' : 'ascending'}`}
              onClick={onToggleOrderDirection}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
            >
              <ArrowDownUp
                className={cn('size-4 transition-transform', direction === 'asc' && 'rotate-180')}
              />
            </button>
            <GroupSelect
              value={sort?.column ?? null}
              columns={orderCols}
              onChange={onOrderByChange}
              placeholder="Default"
              noneLabel="Default"
              testid="table-order-select"
            />
          </div>
        </SettingRow>
      </div>

      <Separator />

      <div className="space-y-2 p-3">
        <div className="font-medium text-muted-foreground text-xs">Display properties</div>
        <div className="flex flex-wrap gap-1.5">
          {columns.map((col) => {
            const locked = col.pinnedLeft;
            // Locked column is always visible & not toggleable.
            const visible = locked || !hiddenSet.has(col.id);
            return (
              <button
                key={col.id}
                type="button"
                disabled={locked}
                data-testid={`display-col-${col.id}`}
                onClick={() => toggle(col.id)}
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  visible
                    ? 'border-primary bg-primary/15 text-foreground'
                    : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
                  locked && 'cursor-default',
                )}
              >
                {col.label}
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      <div className="flex justify-end px-3 py-2">
        <button
          type="button"
          onClick={onReset}
          disabled={isDirty === false}
          className={cn(
            'inline-flex h-8 items-center justify-center rounded-md px-3 text-sm transition-colors',
            isDirty === false
              ? 'cursor-default text-muted-foreground'
              : 'text-foreground hover:bg-muted',
          )}
        >
          Reset
        </button>
      </div>
    </>
  );
}

function Separator() {
  return <div className="h-px shrink-0 bg-border" role="separator" aria-orientation="horizontal" />;
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground text-sm">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

function GroupSelect({
  value,
  columns,
  onChange,
  placeholder,
  noneLabel,
  testid,
}: {
  value: string | null;
  columns: TableColumn[];
  onChange: (next: string | null) => void;
  placeholder: string;
  noneLabel: string;
  testid: string;
}) {
  return (
    <Select
      value={value ?? NO_GROUPING}
      onValueChange={(v) => onChange(v === NO_GROUPING ? null : v)}
    >
      <SelectTrigger className="h-8 w-40" data-testid={testid}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_GROUPING}>{noneLabel}</SelectItem>
        {columns.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
