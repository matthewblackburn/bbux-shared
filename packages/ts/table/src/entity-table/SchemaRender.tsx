import type { Column, ListSchema } from '@bbux/types';
import {
  Archive,
  Award,
  Banknote,
  Bell,
  Boxes,
  Briefcase,
  Building,
  Building2,
  CalendarDays,
  CheckCircle,
  CircleDot,
  Coins,
  CreditCard,
  Database,
  DollarSign,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  HardHat,
  Hash,
  Home,
  IdCard,
  Image,
  Languages,
  Lock,
  type LucideIcon,
  Map as MapIcon,
  MapPin,
  PackageCheck,
  Percent,
  Receipt,
  Repeat,
  Rocket,
  Search,
  Settings2,
  Shield,
  ShoppingCart,
  Smartphone,
  SquareDashed,
  Star,
  Tag,
  Truck,
  Type,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  Wrench,
} from 'lucide-react';
import type { ComponentType, CSSProperties, ReactElement, ReactNode } from 'react';
import { TableCell } from '../table';
import { type CellProps, CELL_REGISTRY, TextCell } from './cells';
import { RefLinkCell } from './cells/RefLinkCell';
import type { FilterField, FilterValue } from '@bbux/types';

// Bridges server-provided schemas to the existing filter / cell
// primitives. Five pieces:
//
//   resolveIcon          map lucide name string ("MapPin") to component.
//                        Bootstrap sends icon names because strings are
//                        JSON-safe; the frontend owns the icon library.
//   resolveFilterColor   palette token → tailwind text-colour class.
//   columnToFilterFields translate a server Column into 0-2
//                        FilterFields (picker for kind=ref/enum/bool,
//                        text search for everything else). Source of
//                        truth — all filter / chart-slice / grouping
//                        UI flows from per-column metadata.
//   getPath              resolve a dotted path against an arbitrary
//                        row object. Any null hop short-circuits.
//   renderCell           dispatch a server Column + row into a
//                        <TableCell>. New column types land here.

const ICONS: Record<string, LucideIcon> = {
  Archive,
  Award,
  Banknote,
  Bell,
  Boxes,
  Briefcase,
  Building,
  Building2,
  CalendarDays,
  CheckCircle,
  CircleDot,
  Coins,
  CreditCard,
  Database,
  DollarSign,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  HardHat,
  Hash,
  Home,
  IdCard,
  Image,
  Languages,
  Lock,
  Map: MapIcon,
  MapPin,
  PackageCheck,
  Percent,
  Receipt,
  Repeat,
  Rocket,
  Search,
  Settings2,
  Shield,
  ShoppingCart,
  Smartphone,
  SquareDashed,
  Star,
  Tag,
  Truck,
  Type,
  UserRound,
  Users,
  Wallet,
  Warehouse,
  Wrench,
};

export function resolveIcon(name: string | undefined): LucideIcon {
  if (!name) return CircleDot;
  return ICONS[name] ?? CircleDot;
}

// Palette tokens the backend is allowed to pick from. Each maps to a
// text colour (used for filter icons in the menu, chips, and group
// headers). Unknown / empty tokens fall back to neutral so a missing
// color field doesn't break the UI.
//
// The `primary` token is intentionally NOT in this map — within an
// entity each ref/enum/bool column gets a unique decorative colour so
// adjacent columns are visually distinct. Brand `text-primary` is
// reserved for action emphasis (links, the active row dot, etc.).
const FILTER_COLORS: Record<string, string> = {
  // Semantic — keep these coupled to meaning.
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-text-muted',
  // Decorative — for ref/enum/bool icon variety. Tokens defined in
  // index.css :root and .dark with light/dark-tuned values.
  purple: 'text-purple',
  pink: 'text-pink',
  cyan: 'text-cyan',
  teal: 'text-teal',
  indigo: 'text-indigo',
  lime: 'text-lime',
  rose: 'text-rose',
  fuchsia: 'text-fuchsia',
  sky: 'text-sky',
  emerald: 'text-emerald',
  violet: 'text-violet',
  orange: 'text-orange',
  amber: 'text-amber',
};

export function resolveFilterColor(token: string | undefined): string {
  if (!token) return FILTER_COLORS.neutral;
  return FILTER_COLORS[token] ?? FILTER_COLORS.neutral;
}

// columnToFilterFields produces 0–2 FilterFields per column:
//
//   kind=ref       async picker (key=filter_key alias) +
//                  text search (key=key, the row data path)
//   kind=enum/bool static picker (key=key) — no text search; values
//                  are the inline col.values
//   else           text search (key=key) — the searchable section
//                  in the popover surfaces every column at least
//                  once
//
// FilterPopover groups the result by FilterField.kind into the
// References vs Searchable sections automatically — consumers never
// need to know the pairing.
export function columnToFilterFields(c: Column): FilterField[] {
  const fields: FilterField[] = [];
  const icon = resolveIcon(c.icon);
  const iconClassName = resolveFilterColor(c.color);

  if (c.kind === 'ref') {
    fields.push({
      kind: 'async',
      key: c.filter_key ?? c.key,
      label: c.label,
      icon,
      iconClassName,
      distinctUrl: c.distinct_path ?? '',
    });
  } else if (c.kind === 'enum' || c.kind === 'bool') {
    fields.push({
      kind: 'static',
      key: c.filter_key ?? c.key,
      label: c.label,
      icon,
      iconClassName,
      values: (c.values ?? []) as ReadonlyArray<FilterValue>,
      distinctUrl: c.distinct_path || undefined,
    });
  }

  // Searchable text filter for every column except enum / bool
  // pickers. Text rendering of the chip uses the Search icon and a
  // neutral colour — the picker (above) carries the column's own
  // visual identity.
  if (c.kind !== 'enum' && c.kind !== 'bool') {
    fields.push({
      kind: 'text',
      key: c.key,
      label: c.label,
      icon: Search,
      iconClassName: resolveFilterColor('neutral'),
    });
  }

  return fields;
}

// Convenience flat-map for consumers that want every FilterField
// the schema produces.
export function schemaToFilterFields(schema: ListSchema): FilterField[] {
  return schema.columns.flatMap(columnToFilterFields);
}

// In the column-driven model, the group key IS the row-side data
// path — the column's Key field. This helper validates the key
// against the schema's columns and returns the path (= the key
// itself) or null when the key isn't a known column.
export function groupingPath(schema: ListSchema, key: string): string | null {
  return schema.columns.find((c) => c.key === key) ? key : null;
}

// Walks a dotted path against an object. null / undefined anywhere
// in the chain resolves to undefined.
//
// Arrays trigger a fan-out: the remaining path segments are walked
// against EACH item, results collected into a flat array. So
// `edges.sites.name` on a row whose `edges.sites` is `[{name:'a'},
// {name:'b'}]` resolves to `['a', 'b']`. Without this, M2M reverse
// columns (customer.sites, site.contacts, etc.) would render
// undefined → blank cells, even though the API is returning the
// data correctly.
export function getPath(row: unknown, path: string): unknown {
  const segments = path.split('.');
  return walk(row, segments, 0);
}

function walk(value: unknown, segments: ReadonlyArray<string>, i: number): unknown {
  if (i >= segments.length) return value;
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    // Fan out: walk the remaining path against each item, drop
    // undefined / null results, flatten one level (each step yields
    // either a scalar or another array). Empty array → undefined so
    // cells reading the result render the standard placeholder.
    const out: unknown[] = [];
    for (const item of value) {
      const r = walk(item, segments, i);
      if (r === undefined || r === null) continue;
      if (Array.isArray(r)) out.push(...r);
      else out.push(r);
    }
    return out.length === 0 ? undefined : out;
  }
  if (typeof value !== 'object') return undefined;
  return walk((value as Record<string, unknown>)[segments[i]], segments, i + 1);
}

// edge-segment → detail-page URL prefix. Used by ref-link cell
// rendering: if a column's key looks like `edges.<segment>.<leaf>`
// and <segment> appears here, the cell renders react-router <Link>s
// into the related entity's detail page.
//
// Naming variants (customer_contact, primary_contact, etc.) all map
// to the same underlying entity; keep them all here so the lookup
// is a flat constant-time check.
const EDGE_LINK_BASE: Record<string, string> = {
  customer: '/people/customers',
  customers: '/people/customers',
  site: '/people/sites',
  sites: '/people/sites',
  contact: '/people/contacts',
  contacts: '/people/contacts',
  primary_contact: '/people/contacts',
  customer_contact: '/people/contacts',
  site_contact: '/people/contacts',
  vendor: '/people/suppliers',
  vendors: '/people/suppliers',
  employee: '/people/employees',
  employees: '/people/employees',
  staff_employee: '/people/employees',
  test_record_employee: '/people/employees',
  project_manager_employee: '/people/employees',
  salesperson_employee: '/people/employees',
  technicians: '/people/employees',
  contractor: '/people/contractors',
  contractors: '/people/contractors',
  staff_contractor: '/people/contractors',
  project_manager_contractor: '/people/contractors',
  salesperson_contractor: '/people/contractors',
  contractor_technicians: '/people/contractors',
  job: '/jobs/all',
  jobs: '/jobs/all',
  parent_job: '/jobs/all',
  quote: '/quotes/all',
  quotes: '/quotes/all',
  parent_quote: '/quotes/all',
  lead: '/leads',
  leads: '/leads',
  parent_lead: '/leads',
  invoice: '/invoices/all',
  invoices: '/invoices/all',
  recurring_invoice: '/recurring/invoices',
  staff_plant: '/materials/plants',
  plant: '/materials/plants',
  customer_asset: '/people/customers',
};

// extractRefSegment pulls the entity-segment out of a key like
// `edges.<segment>.<leaf>` (e.g. `edges.sites.name` → `sites`).
// Returns null for non-edge keys or unrecognised segments.
function extractRefSegment(key: string): string | null {
  const parts = key.split('.');
  if (parts.length < 3) return null;
  if (parts[0] !== 'edges') return null;
  const segment = parts[1];
  return EDGE_LINK_BASE[segment] ? segment : null;
}

// Read the parent edge value(s) — i.e. the object(s) at the path
// minus its trailing leaf. So for `edges.sites.name`, this resolves
// `edges.sites` (the array of site objects with id+name).
function readEdgeEntries(
  row: unknown,
  key: string,
  segment: string,
): import('./cells/RefLinkCell').RefEntry[] {
  const parts = key.split('.');
  const leaf = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join('.');
  const parent = getPath(row, parentPath);
  const items: unknown[] = Array.isArray(parent) ? parent : parent != null ? [parent] : [];
  const base = EDGE_LINK_BASE[segment];
  const out: import('./cells/RefLinkCell').RefEntry[] = [];
  for (const item of items) {
    if (item == null || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = obj.id;
    if (typeof id !== 'string' || id === '') continue;
    const labelRaw = obj[leaf];
    const label =
      typeof labelRaw === 'string' && labelRaw !== ''
        ? labelRaw
        : typeof labelRaw === 'number'
          ? String(labelRaw)
          : '';
    if (label === '') continue;
    out.push({ id, label, href: `${base}/${id}` });
  }
  return out;
}

export function renderCell(
  col: Column,
  row: unknown,
  index: number,
  cellExtras?: {
    className?: string;
    style?: CSSProperties;
    linkHref?: string;
    // Per-column render escape hatch: when provided, the column renders this
    // instead of a registry cell (used by consumers with arbitrary typed cells
    // — badges, avatars, action buttons — that don't map to a schema type).
    override?: (row: unknown) => ReactNode;
    // Extra cell types merged over the built-in CELL_REGISTRY (consumer-injected
    // cells like bbux's url / entity-type / media-tile).
    registry?: Record<string, ComponentType<CellProps>>;
  },
): ReactElement {
  const isFirst = index === 0;

  // Consumer-supplied render escape hatch wins over any schema-driven cell.
  if (cellExtras?.override) {
    return (
      <TableCell key={col.key} className={cellExtras.className} style={cellExtras.style}>
        {cellExtras.override(row)}
      </TableCell>
    );
  }

  // bbux reference column: the value is a { id, label } object resolved by the
  // content engine; render the label as a link to the target's detail page.
  if (col.refListField) {
    const v = getPath(row, col.key) as { id?: unknown; label?: unknown } | null;
    const entries =
      v && v.id != null
        ? [
            {
              id: String(v.id),
              label: String(v.label ?? v.id),
              href: `/${col.refListField}/${String(v.id)}`,
            },
          ]
        : [];
    return (
      <RefLinkCell
        key={col.key}
        entries={entries}
        isFirst={isFirst}
        className={cellExtras?.className}
        style={cellExtras?.style}
      />
    );
  }

  // Ref columns whose key walks through a known edge segment
  // render as <Link>s to the related detail page. Keeps clicks on
  // a customer / site / job / etc. cell navigating where users
  // expect.
  if (col.kind === 'ref') {
    const segment = extractRefSegment(col.key);
    if (segment) {
      const entries = readEdgeEntries(row, col.key, segment);
      if (entries.length > 0) {
        return (
          <RefLinkCell
            key={col.key}
            entries={entries}
            isFirst={isFirst}
            className={cellExtras?.className}
            style={cellExtras?.style}
          />
        );
      }
    }
  }

  const value = getPath(row, col.key);
  const registry = cellExtras?.registry
    ? { ...CELL_REGISTRY, ...cellExtras.registry }
    : CELL_REGISTRY;
  const Cell = registry[col.type] ?? unknownCellFallback(col.type);
  // linkHref is forwarded to TextCell only — other cell variants
  // ignore it. The pinned-left primary column is always
  // type='text', so wrapping in a Link there is enough.
  return (
    <Cell
      key={col.key}
      value={value}
      isFirst={isFirst}
      className={cellExtras?.className}
      style={cellExtras?.style}
      linkHref={cellExtras?.linkHref}
    />
  );
}

const warnedTypes = new Set<string>();

function unknownCellFallback(type: string): typeof TextCell {
  if (import.meta.env.DEV && !warnedTypes.has(type)) {
    warnedTypes.add(type);
    console.warn(
      `[entity-list] unknown cell type %o — falling back to TextCell. ` +
        `Add it to CELL_REGISTRY in components/entity-list/cells/index.ts.`,
      type,
    );
  }
  return TextCell;
}
