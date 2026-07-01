export {
  FilterPopover,
  FilterMenuItems,
  type FilterPopoverProps,
  type FilterMenuItemsProps,
  type LoadOptions,
} from './filter-popover';
export {
  DisplayOptions,
  type DisplayOptionsProps,
  TableSettingsContent,
  type TableSettingsContentProps,
  type SettingsColumn,
  type SettingsSchema,
} from './display-options';
export {
  ChartView,
  type ChartViewProps,
  type ChartViewClientProps,
  type ChartViewCountProps,
  type ChartDateField,
  type RunCounts,
  bucketNumeric,
  countDistinct,
} from './chart-view';
export type { TableColumn, TableSort } from './types';

// Self-contained shadcn/ui primitives the components are built on, copied
// verbatim from bbux. Re-exported so consumers can compose the trigger
// stacks (DropdownMenu root/trigger for the filter menu, etc.) without
// depending on bbux app infra.
export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './dropdown-menu';
export { Button, buttonVariants } from './button';
export { Separator } from './separator';
export { Input } from './input';
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';
