import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '../../button';
import { cn } from '../../cn';

// Page-level banner per DESIGN.md §Errors: "Page-level errors at the top of
// the content area as a dismissible banner." Variants share the Badge ink
// pairing so a danger banner reads consistently with a danger Badge.

const bannerVariants = cva('flex items-start gap-3 rounded-sm border px-3 py-2 text-sm', {
  variants: {
    variant: {
      info: 'bg-info-subtle text-info border-info-subtle',
      success: 'bg-success-subtle text-success border-success-subtle',
      warning: 'bg-warning-subtle text-warning border-warning-subtle',
      danger: 'bg-danger-subtle text-danger border-danger-subtle',
    },
  },
  defaultVariants: { variant: 'info' },
});

const iconFor = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  danger: AlertCircle,
} as const;

export interface BannerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof bannerVariants> {
  title?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  /** Override the leading icon; defaults to a variant-appropriate one. */
  icon?: ReactNode;
}

export function Banner({
  className,
  variant = 'info',
  title,
  action,
  onDismiss,
  icon,
  children,
  ...props
}: BannerProps) {
  const Icon = iconFor[variant ?? 'info'];
  return (
    <div className={cn(bannerVariants({ variant }), className)} role="status" {...props}>
      <span className="mt-0.5 shrink-0">{icon ?? <Icon className="size-4" aria-hidden />}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5', 'text-xs')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {onDismiss ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-1 -mr-1 size-6 p-0 text-current hover:bg-transparent hover:text-current"
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
