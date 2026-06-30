import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// cn merges Tailwind class strings intelligently, so conflicting utilities
// (e.g. "p-2" + "p-4") collapse to the last one. Required by shadcn/ui
// components and recommended by DESIGN.md.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
