import React from "react";

import { cx } from "../../lib/cn";

export type StepStatus = "complete" | "current" | "upcoming" | "invalid";

export interface Step {
  /** Visible label. Also the accessible name — keep it stable for e2e. */
  label: string;
  /**
   * Makes a step a link. Supply it only for steps the user may return to;
   * an upcoming step should not be reachable by clicking ahead.
   */
  href?: string;
  status: StepStatus;
}

export interface StepperProps {
  steps: Step[];
  /** Names the list for screen readers, e.g. "Application steps". */
  label: string;
  className?: string;
  /**
   * Renders `<a>` for steps that have an `href`. Pass Next's `Link` to keep
   * client-side navigation; defaults to a plain anchor.
   */
  linkComponent?: React.ElementType;
}

const TONE: Record<StepStatus, string> = {
  // `current` is the only step carrying the accent — one strong signal.
  current: "bg-accent-soft text-accent font-medium",
  complete: "text-positive",
  invalid: "text-critical",
  upcoming: "text-ink-subtle",
};

/**
 * A horizontal step indicator.
 *
 * Extracted verbatim (semantics-wise) from the loan ApplicationWizard, where it
 * was a private function. The markup below is load-bearing and was already
 * correct: an ordered list named by `aria-label`, `aria-current="step"` on the
 * active item, and the number/check glyph hidden from assistive tech because it
 * duplicates information the list structure already conveys.
 *
 * Below `sm` the pill row is replaced by "Step 2 of 4 — Loan Details" plus a
 * progress bar. A four-across pill row is unreadable at 375px, which is the
 * width field staff actually use.
 */
export function Stepper({
  steps,
  label,
  className,
  linkComponent: Link = "a",
}: StepperProps) {
  const current = steps.find((s) => s.status === "current");
  const currentIndex = current ? steps.indexOf(current) : -1;
  const position = currentIndex === -1 ? steps.length : currentIndex + 1;

  return (
    <>
      {/* Compact: small screens only. */}
      <div className={cx("sm:hidden", className)}>
        <p className="text-ink text-sm font-medium">
          Step {position} of {steps.length}
          {current ? ` — ${current.label}` : ""}
        </p>
        <div
          className="bg-surface-sunken mt-2 h-1 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={position}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-label={label}
        >
          <div
            className="bg-accent h-full transition-[width]"
            style={{ width: `${(position / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Full: sm and up. */}
      <ol
        className={cx("hidden flex-wrap gap-2 sm:flex", className)}
        aria-label={label}
      >
        {steps.map((step, index) => {
          const inner = (
            <>
              <span aria-hidden="true">
                {step.status === "complete" ? "✓" : index + 1}
              </span>
              {step.label}
            </>
          );
          const base = cx(
            "flex items-center gap-2 rounded-control px-3 py-2 text-sm",
            TONE[step.status],
          );

          return (
            <li
              key={step.label}
              aria-current={step.status === "current" ? "step" : undefined}
            >
              {step.href ? (
                <Link
                  href={step.href}
                  className={cx(
                    base,
                    "focus-visible:ring-focus hover:bg-surface-sunken focus-visible:ring-2 focus-visible:outline-none",
                  )}
                >
                  {inner}
                </Link>
              ) : (
                <span className={base}>{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default Stepper;
