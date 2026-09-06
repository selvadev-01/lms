/**
 * Public surface of @lms/ui. Presentation only — no business logic, no data
 * fetching, nothing LMS-specific.
 */

export { cn, cx } from "./lib/cn";

export { default as Alert } from "./components/alert/Alert";
export { default as Avatar } from "./components/avatar/Avatar";
export { default as AvatarText } from "./components/avatar/AvatarText";
export { default as Badge } from "./components/badge/Badge";
export { default as Button } from "./components/button/Button";
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
} from "./components/button/Button";
export { ConfirmDialog } from "./components/confirm-dialog/ConfirmDialog";
export { DataTable } from "./components/data-table/DataTable";
export type { Column, DataTableProps } from "./components/data-table/DataTable";
export { Pagination } from "./components/pagination/Pagination";
export { EmptyState, NoResults } from "./components/empty-state/EmptyState";
export { Panel, PanelHeader } from "./components/panel/Panel";
export {
  Skeleton,
  SkeletonPanel,
  SkeletonTable,
} from "./components/skeleton/Skeleton";
export { Stepper } from "./components/stepper/Stepper";
export type { Step, StepStatus } from "./components/stepper/Stepper";
export { Dropdown } from "./components/dropdown/Dropdown";
export { DropdownItem } from "./components/dropdown/DropdownItem";
export { default as ResponsiveImage } from "./components/images/ResponsiveImage";
export { default as ThreeColumnImageGrid } from "./components/images/ThreeColumnImageGrid";
export { default as TwoColumnImageGrid } from "./components/images/TwoColumnImageGrid";
export { Modal } from "./components/modal";
export {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "./components/table";
