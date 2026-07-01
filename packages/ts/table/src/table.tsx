'use client';

import * as React from 'react';

import { cn } from './cn';

function Table({
  className,
  containerClassName,
  containerRef,
  tableRef,
  ...props
}: React.ComponentProps<'table'> & {
  containerClassName?: string;
  containerRef?: React.Ref<HTMLDivElement>;
  tableRef?: React.Ref<HTMLTableElement>;
}) {
  return (
    <div
      ref={containerRef}
      data-slot="table-container"
      className={cn('relative w-full overflow-x-auto', containerClassName)}
    >
      <table
        ref={tableRef}
        data-slot="table"
        // border-separate + border-spacing-0 keeps `position: sticky`
        // reliable on individual <th>/<td> cells. Under Tailwind
        // preflight's default `border-collapse: collapse`, sticky
        // cells render inconsistently across browsers (Safari
        // outright ignores it on body cells). We never use real CSS
        // borders on cells anyway — the entity-list table draws its
        // visual rules with inset box-shadows — so collapse vs.
        // separate is a free swap visually.
        className={cn('w-full caption-bottom border-separate border-spacing-0 text-sm', className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b hover:bg-(--row-bg-hover) has-aria-expanded:bg-(--row-bg-hover) data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        // overflow-hidden + text-ellipsis keeps nowrap content
        // inside its column and shows … for truncated text under
        // table-layout: fixed (resizable columns). In auto layout
        // neither has a visible effect because cells auto-size
        // to content.
        'overflow-hidden p-2 align-middle text-ellipsis whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
