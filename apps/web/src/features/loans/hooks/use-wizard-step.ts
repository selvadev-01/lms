"use client";

import {
  LOAN_APPLICATION_STEPS,
  type LoanApplicationStep,
} from "@lms/validation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * The wizard's current step, held in the URL.
 *
 * WHY the URL and not `useState`: the step used to be local state, so a refresh
 * or a browser Back dropped the user to step one having lost everything, and no
 * step could be linked to. Putting it in the address bar makes Back, Forward,
 * refresh and "send me that screen" all work for free, because they become
 * ordinary navigation.
 *
 * WHY a query param and not a route segment (`/new/terms`): a segment is a
 * server round trip, and the parent page fetches customers, schemes, scheme
 * terms, scheme types and purposes. Traversing four steps would refetch all of
 * those four times — around twenty requests against a global 60/min limit,
 * which the dashboard has already been bitten by. A query param re-renders the
 * same mounted client component and fetches nothing. It also keeps
 * `nav-items.tsx` untouched, whose filesystem test asserts every nav path has a
 * matching `page.tsx`.
 *
 * WHY a slug and not `?step=2`: the URL says what it is, and inserting a step
 * later does not silently send an old link to the wrong screen.
 */
export function useWizardStep(): {
  step: LoanApplicationStep;
  index: number;
  goTo: (step: LoanApplicationStep) => void;
  /** Replaces rather than pushes — for correcting an invalid deep link. */
  redirectTo: (step: LoanApplicationStep) => void;
  hrefFor: (step: LoanApplicationStep) => string;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const raw = params.get("step");
  // An unknown or absent slug means the start, not an error page: a mistyped
  // URL should land somewhere usable.
  const step: LoanApplicationStep = LOAN_APPLICATION_STEPS.includes(
    raw as LoanApplicationStep,
  )
    ? (raw as LoanApplicationStep)
    : "customer";

  const hrefFor = useCallback(
    (next: LoanApplicationStep) => {
      const search = new URLSearchParams(params.toString());
      search.set("step", next);
      return `${pathname}?${search.toString()}`;
    },
    [params, pathname],
  );

  const goTo = useCallback(
    (next: LoanApplicationStep) => {
      // `push`, so browser Back walks back through the steps — which is what
      // people expect from a multi-step form and the reason Back exists here at
      // all. `scroll: false` keeps the viewport on the step controls instead of
      // jumping to the top of the page on every advance.
      router.push(hrefFor(next), { scroll: false });
    },
    [hrefFor, router],
  );

  const redirectTo = useCallback(
    (next: LoanApplicationStep) => {
      // `replace`, so a corrected deep link does not leave the invalid step in
      // history for Back to return to.
      router.replace(hrefFor(next), { scroll: false });
    },
    [hrefFor, router],
  );

  return {
    step,
    index: LOAN_APPLICATION_STEPS.indexOf(step),
    goTo,
    redirectTo,
    hrefFor,
  };
}
