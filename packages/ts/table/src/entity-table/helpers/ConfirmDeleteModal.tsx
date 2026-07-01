import { Kbd, ModalPanel } from '@bbux/ui';
import { Check, Copy, Loader2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from '../../button';
import { Input } from '../../input';

// Display-only shortcut labels; the actual key listeners below are hardcoded.
const SHORTCUT_SUBMIT = { modifier: '⌘', key: '↵' };
const SHORTCUT_COPY_NAME = { modifier: '⌘⇧', key: 'C' };

const kbd = (s: { modifier?: string; key: string }) => `${s.modifier ?? ''}${s.key}`;

// ConfirmDeleteModal — the one-true-way to confirm a destructive delete (every
// delete in the app routes through here: page headers, the account tree, deploy
// domains, roles, users, the builder). Mirrors cairn's type-the-name friction
// guard, rendered through bbux's modal manager as a docked ModalPanel (CLAUDE.md:
// never render a <Dialog> inline). The to-type name sits in a little label with
// a copy IconAction (⌘⇧C), Resend-style, so you can paste it to confirm; the
// Delete button submits on ⌘↵ like every other modal.
export function ConfirmDeleteModal({
  entityType,
  entityName,
  description,
  onConfirm,
  onClose,
}: {
  /** Lowercase noun for the title/button, e.g. "definition", "article". */
  entityType: string;
  /** The exact text the user must type to confirm (the entity's display name). */
  entityName: string;
  /** Optional extra context shown under the prompt (e.g. cascade notes). */
  description?: ReactNode;
  /** May be async; the modal stays open and shows the error if it throws. */
  onConfirm: () => unknown;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const target = entityName.trim();
  const canConfirm = typed.trim() === target && target.length > 0;

  const handleConfirm = async () => {
    if (!canConfirm || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Could not delete.');
      setPending(false);
    }
  };

  // ⌘↵ / Ctrl+↵ submits (the guarded handler no-ops until the name matches),
  // like every other modal's primary action.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const copyName = () => {
    if (!target) return;
    void navigator.clipboard?.writeText(target);
    setCopied(true);
  };
  // ⌘⇧C copies the to-type name. Scoped to this modal (the listener only exists
  // while it's mounted), so it never clashes with the deploy modal's ⌘⇧C.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        copyName();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Reset the copied tick shortly after it shows.
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <ModalPanel
      title={`Delete ${entityType}?`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm || pending}
            aria-busy={pending || undefined}
            data-testid="confirm-delete-submit"
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            Delete {entityType}
            <Kbd>
              {SHORTCUT_SUBMIT.modifier}
              {SHORTCUT_SUBMIT.key}
            </Kbd>
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {description ? <div className="text-sm text-text-muted">{description}</div> : null}
        <p className="text-sm font-medium text-destructive">This cannot be undone.</p>
        <p className="inline-flex flex-wrap items-center gap-1.5 text-sm text-text-muted">
          To confirm, type
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted py-0.5 pr-1 pl-2">
            <code className="text-xs font-medium text-text">{target || '(unnamed)'}</code>
            <button
              type="button"
              onClick={copyName}
              disabled={!target}
              aria-label={copied ? 'Copied' : 'Copy name'}
              title={`${copied ? 'Copied' : 'Copy name'} ${kbd(SHORTCUT_COPY_NAME)}`}
              data-testid="confirm-delete-copy"
              className="inline-flex size-5 items-center justify-center rounded text-text-muted hover:text-text disabled:opacity-50 [&>svg]:size-3.5"
            >
              {copied ? <Check className="text-success" /> : <Copy />}
            </button>
          </span>
          below.
        </p>
        <Input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={target}
          aria-label={`Type ${target} to confirm`}
          data-testid="confirm-delete-input"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canConfirm && !pending) handleConfirm();
          }}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </ModalPanel>
  );
}
