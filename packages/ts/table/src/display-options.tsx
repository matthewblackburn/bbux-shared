import type { TableSettings } from '@bbux/types';
import {
  defaultTableSettings,
  isColumnVisible,
  setGroupBy,
  setSubGroupBy,
  toggleColumn,
} from '@bbux/types';
import { ArrowDownUp } from 'lucide-react';
import { Button } from './button';
import { cn } from './cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import { Separator } from './separator';
import type { TableColumn, TableSort } from './types';

// Display-options popover BODY.
//
// Two entry points render the SAME markup, one per consumer:
//
//   • TableSettingsContent — bbux's REAL component, copied verbatim from
//     apps/web/src/components/entity-list/TableSettings.tsx. Driven by a
//     ListSchema + a @bbux/types TableSettings + onChange. bbux consumes
//     this UNCHANGED (only the import paths are rewired: @/components/ui/* →
//     ./*, @/lib/utils → ./cn, ./types/table-settings-types → @bbux/types).
//
//   • DisplayOptions — a generic adapter (columns / hidden / grouping /
//     ordering / reset + optional groupable/orderable/isDirty knobs) for
//     consumers (tcms) that model columns as id/label/hidden-set rather than
//     a ListSchema. It renders the same three setting rows, visibility pills,
//     and Reset footer.
//
// The Popover wrapper stays in the consumer's toolbar. Deliberately does NOT
// own the Popover root + trigger — the caller composes
// Popover → Tooltip → PopoverTrigger → Button so Radix asChild forwarding
// reaches the button leaf.

const NO_GROUPING = '__none__';

// ── bbux's real component (schema/settings/onChange) ────────────────

/** Structural shape of a schema column the settings popover needs. bbux's
 *  `Column` (@bbux/shared-types) is assignable, so bbux passes its schema
 *  unchanged; the package stays free of bbux's generated types. */
export interface SettingsColumn {
  key: string;
  label: string;
  sortable?: boolean;
}
export interface SettingsSchema {
  columns: ReadonlyArray<SettingsColumn>;
}

export interface TableSettingsContentProps {
  schema: SettingsSchema;
  settings: TableSettings;
  onChange: (next: TableSettings) => void;
}

export function TableSettingsContent({ schema, settings, onChange }: TableSettingsContentProps) {
  // Every column is groupable in the column-driven model — the
  // column key IS the row data path, so picking any column to group
  // by Just Works.
  const groupables = schema.columns;

  return (
    <>
      <div className="space-y-3 p-3">
        <SettingRow label="Grouping">
          <SchemaGroupSelect
            value={settings.groupBy}
            columns={groupables}
            onChange={(key) => onChange(setGroupBy(settings, key))}
          />
        </SettingRow>
        {settings.groupBy !== null ? (
          <SettingRow label="Sub-grouping">
            <SchemaGroupSelect
              value={settings.subGroupBy}
              columns={groupables.filter((c) => c.key !== settings.groupBy)}
              onChange={(key) => onChange(setSubGroupBy(settings, key))}
            />
          </SettingRow>
        ) : null}
        <SettingRow label="Ordering">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Sort ${settings.orderDirection === 'asc' ? 'descending' : 'ascending'}`}
              onClick={() =>
                onChange({
                  ...settings,
                  orderDirection: settings.orderDirection === 'asc' ? 'desc' : 'asc',
                })
              }
            >
              <ArrowDownUp
                className={cn(
                  'size-4 transition-transform',
                  settings.orderDirection === 'asc' && 'rotate-180',
                )}
              />
            </Button>
            <SchemaOrderSelect
              value={settings.orderBy}
              columns={schema.columns}
              onChange={(key) => onChange({ ...settings, orderBy: key })}
            />
          </div>
        </SettingRow>
      </div>

      <Separator />

      <div className="space-y-2 p-3">
        <div className="text-xs font-medium text-text-muted">Display properties</div>
        <div className="flex flex-wrap gap-1.5">
          {schema.columns.map((col) => {
            const visible = isColumnVisible(settings, col.key);
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => onChange(toggleColumn(settings, col.key))}
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  visible
                    ? 'border-primary bg-primary/15 text-text'
                    : 'border-border bg-transparent text-text-muted hover:text-text',
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
        <Button variant="ghost" size="sm" onClick={() => onChange(defaultTableSettings(schema))}>
          Reset
        </Button>
      </div>
    </>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-text">{label}</span>
      <div className="flex min-w-0 items-center">{children}</div>
    </div>
  );
}

function SchemaGroupSelect({
  value,
  columns,
  onChange,
}: {
  value: string | null;
  columns: ReadonlyArray<SettingsColumn>;
  onChange: (next: string | null) => void;
}) {
  return (
    <Select
      value={value ?? NO_GROUPING}
      onValueChange={(v) => onChange(v === NO_GROUPING ? null : v)}
    >
      <SelectTrigger className="h-8 w-40">
        <SelectValue placeholder="No grouping" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_GROUPING}>No grouping</SelectItem>
        {columns.map((c) => (
          // No icon — grouping is column-keyed and the dropdown
          // stays text-only per the design (icons crowd the row
          // when every column is selectable).
          <SelectItem key={c.key} value={c.key}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SchemaOrderSelect({
  value,
  columns,
  onChange,
}: {
  value: string | null;
  columns: ReadonlyArray<SettingsColumn>;
  onChange: (next: string | null) => void;
}) {
  // Only surface columns the backend has an order_by resolver for.
  // Listing a non-sortable column here would send an unknown
  // order_by and trip the repo's 400 allowlist check — same rule as
  // the column-header click-to-sort buttons.
  const sortable = columns.filter((c) => c.sortable === true);
  return (
    <Select
      value={value ?? NO_GROUPING}
      onValueChange={(v) => onChange(v === NO_GROUPING ? null : v)}
    >
      <SelectTrigger className="h-8 w-40">
        <SelectValue placeholder="Default" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_GROUPING}>Default</SelectItem>
        {sortable.map((c) => (
          <SelectItem key={c.key} value={c.key}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Generic adapter (tcms) ──────────────────────────────────────────

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
   * `columns`. A consumer can restrict grouping (e.g. enum-ish columns only)
   * while still showing every column as a visibility pill.
   */
  groupableColumns?: TableColumn[];
  /**
   * Optional: columns eligible for Ordering. Defaults to `columns`.
   */
  orderableColumns?: TableColumn[];
  /**
   * Optional: when false, the Reset button renders muted/disabled to
   * signal the view is already at defaults. Omitted → Reset is always
   * enabled.
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
          <GenericGroupSelect
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
            <GenericGroupSelect
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Sort ${direction === 'asc' ? 'descending' : 'ascending'}`}
              onClick={onToggleOrderDirection}
            >
              <ArrowDownUp
                className={cn('size-4 transition-transform', direction === 'asc' && 'rotate-180')}
              />
            </Button>
            <GenericGroupSelect
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
        <div className="text-xs font-medium text-text-muted">Display properties</div>
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
                    ? 'border-primary bg-primary/15 text-text'
                    : 'border-border bg-transparent text-text-muted hover:text-text',
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={isDirty === false}
          className={isDirty === false ? 'text-text-muted' : undefined}
        >
          Reset
        </Button>
      </div>
    </>
  );
}

function GenericGroupSelect({
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
