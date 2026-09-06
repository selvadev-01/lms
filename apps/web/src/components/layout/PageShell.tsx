import React, { type ReactNode } from "react";

import Breadcrumbs, { type Crumb } from "./Breadcrumbs";

export interface PageShellProps {
  title: string;
  /** One line saying what this screen is for. Skip it when the title suffices. */
  description?: ReactNode;
  /** Primary controls for the whole page: "New customer", "Export". */
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  children: ReactNode;
}

/**
 * The standard page frame: breadcrumbs, an h1, an actions slot, then content.
 *
 * Exists because ~90 pages hand-rolled this, each pairing a `PageBreadCrumb`
 * with an inline `rounded-2xl border …` panel string, and each deciding for
 * itself where a "New …" button went. The actions slot is the substantive
 * addition — `PageBreadCrumb` had nowhere to put one, so every page invented a
 * different corner for it.
 *
 * A server component: it holds no state, so pages stay server components too.
 */
export function PageShell({
  title,
  description,
  actions,
  breadcrumbs,
  children,
}: PageShellProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* One h1 per page. The sidebar and header carry no heading, so
                this is the document's top level, not an h2 as before. */}
            <h1 className="text-ink text-xl font-semibold tracking-tight">
              {title}
            </h1>
            {description ? (
              <p className="text-ink-muted mt-1 text-sm">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export default PageShell;
