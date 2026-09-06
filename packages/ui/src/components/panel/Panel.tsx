import { cva, type VariantProps } from "class-variance-authority";
import React, { type ReactNode } from "react";

import { cx } from "../../lib/cn";

/**
 * The standard content surface.
 *
 * Replaces the string that was copy-pasted inline across ~90 pages:
 *   rounded-2xl border border-gray-200 bg-white p-5 lg:p-6
 *   dark:border-gray-800 dark:bg-white/[0.03]
 *
 * Differences that are deliberate, not drift: a 10px radius instead of 16px
 * (panels should read as documents, not cards), a hairline border carrying the
 * separation instead of a shadow, and semantic tokens so there are no `dark:`
 * variants to keep in sync.
 */
const panel = cva("border-line bg-surface border", {
  variants: {
    padding: {
      // For a DataTable or anything that must bleed to the panel edge.
      none: "",
      tight: "p-4",
      default: "p-5 lg:p-6",
    },
    radius: {
      default: "rounded-panel",
      // Squared off when a panel sits flush against another element.
      none: "rounded-none",
    },
    elevated: {
      true: "shadow-panel",
    },
  },
  defaultVariants: { padding: "default", radius: "default", elevated: true },
});

export interface PanelProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof panel> {
  children?: ReactNode;
  /** Renders as `<section>` when given an accessible name. */
  as?: "div" | "section" | "article";
}

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  function Panel(
    {
      children,
      padding,
      radius,
      elevated,
      className,
      as: Tag = "div",
      ...rest
    },
    ref,
  ) {
    return (
      <Tag
        ref={ref}
        className={cx(panel({ padding, radius, elevated }), className)}
        {...rest}
      >
        {children}
      </Tag>
    );
  },
);

export interface PanelHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned controls: a create button, a filter, a density toggle. */
  actions?: ReactNode;
  className?: string;
  /** Heading level. Pick the one that fits the page outline, not the size. */
  as?: "h2" | "h3" | "h4";
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
  as: Heading = "h2",
}: PanelHeaderProps) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-ink text-base font-semibold tracking-tight">
          {title}
        </Heading>
        {description ? (
          <p className="text-ink-muted mt-1 text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export default Panel;
