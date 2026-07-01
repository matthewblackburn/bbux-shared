import type { ReactNode } from 'react';
import { cn } from '../../cn';

// EmptyState per DESIGN.md: icon, title, one-sentence description, one CTA.
// Nothing more. The Linear reference in docs/design-references/empty-states/
// is centered, vertically stacked, ~320px wide content column.
export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      {icon ? (
        <div className="mb-4 flex size-10 items-center justify-center rounded-md bg-surface-2 text-text-muted">
          {icon}
        </div>
      ) : null}
      <h2 className="text-base font-semibold text-text">{title}</h2>
      {description ? <p className="mt-1 max-w-sm text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
