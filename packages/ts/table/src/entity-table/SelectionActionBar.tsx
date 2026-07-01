import { ModalPanel, useModals } from '@bbux/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  CircleDot,
  Command as CommandIcon,
  Copy,
  Pencil,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDeleteModal } from './helpers/ConfirmDeleteModal';
import { Button } from '../button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../command';
import { Kbd, KbdGroup } from '@bbux/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '@bbux/ui';
import { cn } from '../cn';
import { resolveFilterColor, resolveIcon } from './SchemaRender';
import type { RowActionsConfig } from './types/types';

// Display-only modifier label for the ⌘/Ctrl+K hint.
const CMD_KEY = '⌘';

// SelectionActionBar — the floating bar that appears, centred at the bottom of
// the entity table, while rows are selected: "N selected · ⌘ Actions · ✕". The
// Actions button (and ⌘/Ctrl+K) opens BulkActionsMenu, a command palette of
// actions over the selection. The same menu opens, scoped to one row, from a
// row's "⋯" trigger.

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (noun: string, n: number) => (n === 1 ? noun : `${noun}s`);

export function FloatingSelectionBar({
  count,
  onOpen,
  onClear,
}: {
  count: number;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        <span className="px-3 text-sm font-medium text-text" data-testid="selection-count">
          {count} selected
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpen}
              className="gap-1.5 rounded-full"
              data-testid="selection-actions"
            >
              <CommandIcon className="size-3.5" aria-hidden />
              Actions
            </Button>
          </TooltipTrigger>
          <TooltipContent className="inline-flex items-center gap-1.5">
            Open command menu
            <KbdGroup>
              <Kbd>{CMD_KEY}</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          aria-label="Clear selection"
          className="size-8 rounded-full"
          data-testid="selection-clear"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

// BulkActionsMenu — the command palette opened from the bar (for the selection)
// or a row's "⋯" (for one row). Most actions are projected from the list's
// RowActionsConfig and applied across every passed row; Copy ID / Edit are
// single-row only; Add tag is available to any taggable entity.
export function BulkActionsMenu<T>({
  rows,
  rowActions,
  rowId,
  editHref,
  onNavigate,
  onClear,
  onClose,
}: {
  rows: ReadonlyArray<T>;
  rowActions?: RowActionsConfig<T>;
  rowId: (row: T) => string | undefined;
  editHref: (row: T) => string | undefined;
  onNavigate: (path: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { openModal } = useModals();
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<'root' | 'tags'>('root');
  const [search, setSearch] = useState('');

  const noun = rowActions?.entityNoun ?? 'item';
  const status = rowActions?.status;
  const onDelete = rowActions?.onDelete;
  const baseType = rowActions?.baseType;
  const listField = rowActions?.listField;
  // Tag API is injected by the consumer (see RowActionsConfig.tags); the shared
  // table carries no data layer. Tagging is gated on both baseType AND tagsApi.
  const tagsApi = rowActions?.tags;
  const tagsEnabled = Boolean(baseType && tagsApi);
  const single = rows.length === 1 ? rows[0] : undefined;

  const deletable = onDelete
    ? rows.filter((r) => !rowActions?.canDelete || rowActions.canDelete(r))
    : [];

  const rowIds = rows.map(rowId).filter((id): id is string => Boolean(id));

  // Account tags for the picker — only fetched once that page opens.
  const { data: tagOptions = [] } = useQuery({
    queryKey: ['tags', 'options'],
    queryFn: () => (tagsApi ? tagsApi.options() : Promise.resolve([])),
    enabled: page === 'tags' && Boolean(tagsApi),
  });

  // Tags currently on ALL the rows (for many rows, the intersection): the
  // "applied" set. Adding a tag moves it out of "Add tag" into "Applied";
  // removing moves it back. Kept in local state for instant, optimistic toggles.
  const { data: appliedFromServer } = useQuery({
    queryKey: ['bulk-applied-tags', baseType, ...rowIds],
    queryFn: async () => {
      if (!tagsApi) return [] as string[];
      const per = await Promise.all(rowIds.map((id) => tagsApi.forResource(baseType ?? '', id)));
      if (per.length === 0) return [] as string[];
      let inter = new Set(per[0].map((t) => t.id));
      for (const list of per.slice(1)) {
        const ids = new Set(list.map((t) => t.id));
        inter = new Set([...inter].filter((x) => ids.has(x)));
      }
      return [...inter];
    },
    enabled: page === 'tags' && tagsEnabled && rowIds.length > 0,
  });
  const [applied, setApplied] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (appliedFromServer) setApplied(new Set(appliedFromServer));
  }, [appliedFromServer]);

  // Toggle a tag across every row (optimistic) WITHOUT closing the modal — the
  // user keeps adding/removing and dismisses when done.
  const toggleTag = async (tagId: string, isApplied: boolean) => {
    if (!baseType || !tagsApi) return;
    const prev = applied;
    const next = new Set(prev);
    if (isApplied) next.delete(tagId);
    else next.add(tagId);
    setApplied(next);
    try {
      await Promise.all(
        rowIds.map((id) =>
          isApplied ? tagsApi.untag(baseType, id, tagId) : tagsApi.tag(baseType, id, tagId),
        ),
      );
      if (listField) qc.invalidateQueries({ queryKey: [listField] });
      qc.invalidateQueries({ queryKey: ['entity-tags'] });
    } catch (e) {
      setApplied(prev); // revert the optimistic change
      toast.error(e instanceof Error && e.message ? e.message : 'Could not update tags');
    }
  };

  // Run an action across the given rows, refresh the grid, then clear + close.
  const run = async (label: string, target: ReadonlyArray<T>, fn: (row: T) => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all(target.map(fn));
      if (listField) qc.invalidateQueries({ queryKey: [listField] });
      qc.invalidateQueries({ queryKey: ['entity-tags'] });
      toast.success(`${label} · ${target.length} ${plural(noun, target.length)}`);
      onClear?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  // Delete routes through the type-the-name ConfirmDeleteModal (the one-true-way
  // for destructive deletes — CLAUDE.md), NOT an inline command confirm. For a
  // single row you type its name; for a multi-select you type "N <noun>s". The
  // confirm STACKS on top of the actions menu (the modal manager peeks the menu
  // behind it); only after a successful delete do we dismiss the now-stale menu.
  const requestDelete = () => {
    if (!onDelete || deletable.length === 0) return;
    const n = deletable.length;
    const oneName =
      n === 1 ? (rowActions?.nameOf(deletable[0]) ?? noun) : `${n} ${plural(noun, n)}`;
    const label = n === 1 ? noun : `${n} ${plural(noun, n)}`;
    openModal(({ close }) => (
      <ConfirmDeleteModal
        entityType={label}
        entityName={oneName}
        description={
          n === 1 ? undefined : `This permanently deletes all ${n} selected ${plural(noun, n)}.`
        }
        onConfirm={async () => {
          await Promise.all(deletable.map((r) => onDelete(r)));
          if (listField) qc.invalidateQueries({ queryKey: [listField] });
          qc.invalidateQueries({ queryKey: ['entity-tags'] });
          toast.success(`Deleted · ${n} ${plural(noun, n)}`);
          onClear?.();
          onClose(); // dismiss the (now-stale) actions menu behind the confirm
        }}
        onClose={close}
      />
    ));
  };

  const copyId = async () => {
    const id = single ? rowId(single) : undefined;
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      toast.success('ID copied');
    } catch {
      toast.error('Could not copy ID');
    }
    onClose();
  };

  const edit = () => {
    const href = single ? editHref(single) : undefined;
    if (!href) return;
    onClose();
    onNavigate(href);
  };

  const title = single
    ? rowActions?.nameOf(single) || `1 ${noun}`
    : `${rows.length} ${plural(noun, rows.length)} selected`;

  return (
    <ModalPanel title={title} onClose={onClose} bodyClassName="p-0">
      <Command className="bg-transparent">
        <CommandInput
          placeholder={page === 'tags' ? 'Search tags…' : 'Type a command or search…'}
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>

          {page === 'tags' ? (
            <>
              <CommandGroup>
                <CommandItem
                  value="back"
                  onSelect={() => {
                    setSearch('');
                    setPage('root');
                  }}
                >
                  <ChevronLeft aria-hidden />
                  Back
                </CommandItem>
              </CommandGroup>
              {tagOptions.some((t) => applied.has(t.id)) ? (
                <CommandGroup heading="Applied">
                  {tagOptions
                    .filter((t) => applied.has(t.id))
                    .map((t) => {
                      const Icon = resolveIcon(t.icon);
                      return (
                        <CommandItem
                          key={t.id}
                          value={`applied ${t.title}`}
                          onSelect={() => toggleTag(t.id, true)}
                        >
                          <Icon className={cn('size-4', resolveFilterColor(t.color))} aria-hidden />
                          {t.title}
                          <Check className="ml-auto size-4 text-text-subtle" aria-hidden />
                        </CommandItem>
                      );
                    })}
                </CommandGroup>
              ) : null}
              <CommandGroup heading="Add tag">
                {tagOptions
                  .filter((t) => !applied.has(t.id))
                  .map((t) => {
                    const Icon = resolveIcon(t.icon);
                    return (
                      <CommandItem
                        key={t.id}
                        value={t.title}
                        onSelect={() => toggleTag(t.id, false)}
                      >
                        <Icon className={cn('size-4', resolveFilterColor(t.color))} aria-hidden />
                        {t.title}
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            </>
          ) : (
            <>
              {single ? (
                <CommandGroup heading={noun}>
                  {rowId(single) ? (
                    <CommandItem value="copy id" onSelect={copyId}>
                      <Copy aria-hidden />
                      Copy ID
                    </CommandItem>
                  ) : null}
                  {editHref(single) ? (
                    <CommandItem value="edit" onSelect={edit}>
                      <Pencil aria-hidden />
                      Edit
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              ) : null}

              {status ? (
                <CommandGroup heading="Set status">
                  {status.options.map((opt) => (
                    <CommandItem
                      key={opt}
                      value={`status ${opt}`}
                      disabled={busy}
                      onSelect={() =>
                        run(`Set status to ${titleCase(opt)}`, rows, (r) => status.onChange(r, opt))
                      }
                    >
                      <CircleDot className="text-text-subtle" aria-hidden />
                      Set status: {titleCase(opt)}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {tagsEnabled ? (
                <CommandGroup heading="Tags">
                  <CommandItem
                    value="add remove tags"
                    onSelect={() => {
                      setSearch('');
                      setPage('tags');
                    }}
                  >
                    <TagIcon aria-hidden />
                    Add/remove tags…
                  </CommandItem>
                </CommandGroup>
              ) : null}

              <CommandGroup heading="Actions">
                {onDelete && deletable.length > 0 ? (
                  <CommandItem
                    value="delete"
                    disabled={busy}
                    onSelect={requestDelete}
                    className="text-danger data-[selected=true]:text-danger"
                  >
                    <Trash2 aria-hidden />
                    Delete {deletable.length} {plural(noun, deletable.length)}…
                  </CommandItem>
                ) : null}
                {onClear ? (
                  <CommandItem
                    value="clear selection"
                    onSelect={() => {
                      onClear();
                      onClose();
                    }}
                  >
                    <X aria-hidden />
                    Clear selection
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </ModalPanel>
  );
}
