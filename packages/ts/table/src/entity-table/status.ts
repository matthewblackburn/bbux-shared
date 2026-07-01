// Single source of truth for how a status value maps to a colour. Both the
// list's StatusBadge and the detail-page status dot (StatusMenu) read from here
// so the colour language stays consistent across the app.
//
// People entities share the same status enum (active / inactive / archived).
// Quotes use the stage enum (open / progress / complete / approved / closed /
// archived) for workflow position — distinct values, distinct colours.

export type StatusVariant = 'success' | 'warning' | 'info' | 'neutral' | 'accent';

export function statusVariant(status: string | undefined): StatusVariant {
  switch (status) {
    // People status.
    case 'active':
      return 'success';
    case 'inactive':
      return 'warning';
    // App status (active / draft / archived) — draft is a work-in-progress amber.
    case 'draft':
      return 'warning';
    // Quote stages.
    case 'open':
      return 'info';
    case 'progress':
      return 'warning';
    case 'complete':
      return 'accent';
    case 'approved':
      return 'success';
    // Boolean fields (e.g. is_paid) serialised as 'true'/'false'.
    case 'true':
      return 'success';
    case 'false':
      return 'neutral';
    // archived / closed / unknown fall through.
    default:
      return 'neutral';
  }
}

// Text-colour class for the status dot icon (filled via `fill-current`). Mirrors
// the StatusBadge variant → token mapping so the dot and the badge agree; an
// unset / neutral status reads as a muted dot rather than shouting a colour.
export function statusDotClass(status: string | undefined): string {
  switch (statusVariant(status)) {
    case 'success':
      return 'text-success';
    case 'warning':
      return 'text-warning';
    case 'info':
      return 'text-info';
    case 'accent':
      return 'text-primary';
    default:
      return 'text-text-subtle';
  }
}
