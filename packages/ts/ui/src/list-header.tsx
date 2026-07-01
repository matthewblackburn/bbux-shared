import type { ReactNode } from 'react';

// ListHeader — the list-screen header row shared by bbux and tcms-codes-react.
// Active-filter chips (or any left content) fill the left; the icon-button
// action cluster sits on the right. Extracted VERBATIM from bbux's
// EntityListLayout inline markup (flex items-center gap-2 p-4 py-1, a
// min-w-0 flex-1 left cell, and a shrink-0 gap-0.5 action cluster) so both apps
// render one identical header component rather than lookalikes.
export function ListHeader({ left, children }: { left?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-4 py-1">
      <div className="min-w-0 flex-1">{left}</div>
      {children ? <div className="flex shrink-0 items-center gap-0.5">{children}</div> : null}
    </div>
  );
}
