import { X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { Kbd } from './kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

// Centralised modal manager. Modals are right-docked, full-height FLOATING
// panels (a side popout). Opening another doesn't add another backdrop — there
// is ONE overlay; the panels STACK: the active panel sits on the right, the
// ones behind it scale down and shift left (a peeked card stack). At most 3
// are shown (active + 2 behind); deeper ones stay mounted but hidden.
//
//   const { openModal, closeModal } = useModals();
//   const id = openModal(({ close }) => (
//     <ModalPanel title="New thing" onClose={close} footer={…}>…</ModalPanel>
//   ));
//   // …later: closeModal(id);

export interface ModalApi {
  id: string;
  close: () => void;
}

export type ModalContent = ReactNode | ((api: ModalApi) => ReactNode);

export interface ModalOptions {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  // When false, ESC / overlay click won't close it (caller closes by id).
  dismissable?: boolean;
  onClose?: () => void;
}

interface ModalEntry {
  id: string;
  content: ModalContent;
  opts: ModalOptions;
}

interface ModalContextValue {
  openModal: (content: ModalContent, opts?: ModalOptions) => string;
  closeModal: (id: string) => void;
  closeActive: () => void;
  closeAll: () => void;
  openIds: ReadonlyArray<string>;
  activeId: string | null;
}

const ModalContext = createContext<ModalContextValue | null>(null);

const SIZE_CLASS: Record<NonNullable<ModalOptions['size']>, string> = {
  sm: 'w-[360px]',
  md: 'w-[440px]',
  lg: 'w-[560px]',
  xl: 'w-[720px]',
};

// How far each panel behind the active is shifted/shrunk. Only the first two
// behind the active are shown; the rest are hidden.
const MAX_VISIBLE = 3;
const SHIFT_PX = 28;
const SCALE_STEP = 0.05;
const OPACITY_STEP = 0.25;

// Enter/exit pose: a panel animates between this (slightly larger, pushed in
// from the right, transparent) and its resting transform. Same pose both ways,
// so closing reverses the open. EXIT_MS must exceed the .modal-panel transition
// duration (220ms) so the panel is removed only after it has slid out.
const ENTER_SHIFT_PX = 64;
const ENTER_SCALE = 1.04;
const EXIT_MS = 240;

export function ModalProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ModalEntry[]>([]);
  // Ids past their enter transition (a fresh panel renders once in the enter
  // pose, then is promoted on the next frame so the transition plays).
  const [entered, setEntered] = useState<ReadonlySet<string>>(() => new Set());
  // Ids currently sliding out. They stay mounted (animating) until removed.
  const [exiting, setExiting] = useState<ReadonlySet<string>>(() => new Set());
  const seq = useRef(0);

  // Refs mirror the latest state so the imperative API can read/guard
  // synchronously without re-creating callbacks on every stack change.
  const stackRef = useRef<ModalEntry[]>([]);
  stackRef.current = stack;
  const exitingRef = useRef<Set<string>>(new Set());

  // Begin a panel's exit; it's actually removed once the slide-out finishes.
  const closeModal = useCallback((id: string) => {
    if (exitingRef.current.has(id)) return; // already closing
    if (!stackRef.current.some((m) => m.id === id)) return;
    exitingRef.current.add(id);
    setExiting(new Set(exitingRef.current));
    stackRef.current.find((m) => m.id === id)?.opts.onClose?.();
    window.setTimeout(() => {
      exitingRef.current.delete(id);
      setExiting(new Set(exitingRef.current));
      setStack((prev) => prev.filter((m) => m.id !== id));
      setEntered((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, EXIT_MS);
  }, []);

  const openModal = useCallback((content: ModalContent, opts: ModalOptions = {}) => {
    seq.current += 1;
    const id = `modal-${seq.current}`;
    setStack((prev) => [...prev, { id, content, opts }]);
    return id;
  }, []);

  const closeActive = useCallback(() => {
    const live = stackRef.current.filter((m) => !exitingRef.current.has(m.id));
    const top = live[live.length - 1];
    if (top) closeModal(top.id);
  }, [closeModal]);

  const closeAll = useCallback(() => {
    for (const m of stackRef.current) closeModal(m.id);
  }, [closeModal]);

  // Promote freshly opened panels to "entered" on the next frame so the enter
  // transition plays from the enter pose to the resting transform.
  useEffect(() => {
    const pending = stack
      .filter((m) => !entered.has(m.id) && !exitingRef.current.has(m.id))
      .map((m) => m.id);
    if (pending.length === 0) return;
    const raf = requestAnimationFrame(() => {
      setEntered((prev) => {
        const next = new Set(prev);
        for (const id of pending) next.add(id);
        return next;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [stack, entered]);

  // ESC closes the active (topmost live) modal when dismissable.
  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const live = stack.filter((m) => !exiting.has(m.id));
      const top = live[live.length - 1];
      if (top && top.opts.dismissable !== false) {
        e.preventDefault();
        closeModal(top.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack, exiting, closeModal]);

  // Lock body scroll while any modal is open.
  useEffect(() => {
    if (stack.length === 0) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [stack.length]);

  // Live = panels not currently exiting. Depth/active/the public API all key
  // off live so a closing panel is treated as already gone.
  const live = stack.filter((m) => !exiting.has(m.id));
  const depthOf = new Map<string, number>();
  live.forEach((m, i) => {
    depthOf.set(m.id, live.length - 1 - i);
  });
  const overlayTop = live[live.length - 1];

  const value = useMemo<ModalContextValue>(() => {
    const liveIds = stack.filter((m) => !exiting.has(m.id)).map((m) => m.id);
    return {
      openModal,
      closeModal,
      closeActive,
      closeAll,
      openIds: liveIds,
      activeId: liveIds.length ? liveIds[liveIds.length - 1] : null,
    };
  }, [openModal, closeModal, closeActive, closeAll, stack, exiting]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {stack.length > 0 &&
        createPortal(
          <div className="fixed inset-0 z-50">
            {/* Single overlay — never compounds, no matter how many are open.
                Fades out once the last live panel begins closing. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="modal-overlay absolute inset-0 cursor-default bg-black/30 backdrop-blur-sm"
              style={{ opacity: live.length > 0 ? 1 : 0 }}
              onClick={() => {
                if (overlayTop && overlayTop.opts.dismissable !== false) closeModal(overlayTop.id);
              }}
            />
            {stack.map((m) => {
              const isExiting = exiting.has(m.id);
              const isEntered = entered.has(m.id);
              const depth = depthOf.get(m.id) ?? 0;
              // poseOut = the enter-from / exit-to pose (entering or leaving).
              const poseOut = isExiting || !isEntered;
              const active = !poseOut && depth === 0;
              const hidden = !poseOut && depth >= MAX_VISIBLE;
              return (
                <div
                  key={m.id}
                  role="dialog"
                  aria-modal={active}
                  aria-hidden={!active}
                  data-depth={depth}
                  className={cn(
                    'modal-panel fixed top-4 right-4 bottom-4 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl',
                    hidden && 'hidden',
                    !active && 'pointer-events-none select-none',
                    SIZE_CLASS[m.opts.size ?? 'md'],
                    m.opts.className,
                  )}
                  style={{
                    zIndex: poseOut ? 60 : 50 - depth,
                    transformOrigin: 'center',
                    transform: poseOut
                      ? `translateX(${ENTER_SHIFT_PX}px) scale(${ENTER_SCALE})`
                      : `translateX(${-depth * SHIFT_PX}px) scale(${1 - depth * SCALE_STEP})`,
                    opacity: poseOut ? 0 : Math.max(0, 1 - depth * OPACITY_STEP),
                  }}
                >
                  {typeof m.content === 'function'
                    ? m.content({ id: m.id, close: () => closeModal(m.id) })
                    : m.content}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ModalContext.Provider>
  );
}

// ModalPanel — the standard panel chrome: a header (close X + title + optional
// actions), a scrollable body, and an optional footer. Fills the panel height.
export function ModalPanel({
  title,
  onClose,
  actions,
  footer,
  bodyClassName,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-text-muted transition-colors hover:text-text"
            >
              <X className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="inline-flex items-center gap-1">
            Close <Kbd>esc</Kbd>
          </TooltipContent>
        </Tooltip>
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', bodyClassName)}>
        {children}
      </div>
      {footer ? <div className="border-t border-border px-5 py-4">{footer}</div> : null}
    </div>
  );
}

// useModals returns the modal manager. openModal() returns the new modal's
// id; closeModal(id) dismisses it. Destructure what you need:
//   const { openModal, closeModal, closeActive } = useModals();
export function useModals(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModals must be used within <ModalProvider>');
  return ctx;
}
