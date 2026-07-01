import type { FilterValue } from '@bbux/types';

// Distinct-value pagination for ASYNC (FK/reference) filter pickers.
// Copied from bbux (apps/web/src/components/entity-list/utils/distinct.ts).
//
// bbux ships a dormant stub here: its toListSchema emits no async filter
// fields (only static enums + text), so this returns empty pages and keeps
// FilterPopover compiling. Consumers that DO have a distinct endpoint drive
// the picker instead via the injected `loadOptions` callback on FilterPopover
// (which async/static-remote fields use to page real options).
export const DISTINCT_PAGE_SIZE = 50;

export interface DistinctPage {
  data: FilterValue[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchDistinctPage(
  _baseUrl: string,
  params: { q: string; offset: number; limit: number },
): Promise<DistinctPage> {
  return { data: [], total: 0, limit: params.limit, offset: params.offset };
}
