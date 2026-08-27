import type {
  ApplicationDocumentStatus,
  ApplicationStatus,
  LoanProductStatus,
} from "@lms/types";
import { Badge } from "@lms/ui";
import {
  APPLICATION_STATUS_OPTIONS,
  DOCUMENT_VERIFICATION_STATUS_OPTIONS,
  LOAN_CONFIG_STATUS_OPTIONS,
  labelFor,
} from "@lms/validation";

/**
 * Status badges and money formatting for the loan surfaces.
 *
 * Server components — no `"use client"`. They render text and colour from props
 * and hold no state, so shipping them to the browser would cost bundle size for
 * nothing.
 */

/**
 * Application lifecycle colour.
 *
 * REJECTED and DISBURSED are the terminal states, and they are the two that
 * must read at a glance. The in-flight states share a warning tone
 * deliberately: to a branch clerk they all mean "not decided yet", and separate
 * colours would imply a distinction the user does not act on.
 *
 * APPROVED, SANCTIONED and CUSTOMER_ACCEPTED are green-ish rather than warning:
 * each is a real step forward that a user *did* act to reach. They are not
 * terminal — the loan is not live until it is disbursed — but colouring them as
 * pending would hide the progress the branch just made.
 *
 * `Record<ApplicationStatus, ...>` rather than a partial map on purpose: when a
 * status is added to the union, this object is where the compiler stops, which
 * is the cheapest possible place to be reminded. Module 09 added the last two
 * and this is exactly where it was caught.
 *
 * DISBURSEMENT_PENDING is `warning` rather than `success` because it is an
 * action queue, not an achievement: money is owed to the borrower and has not
 * moved. AGREEMENT_SIGNED loses its terminal green for the same reason — it is
 * now the state a loan sits in *waiting* to be scheduled.
 */
const APPLICATION_TONE: Record<
  ApplicationStatus,
  "success" | "warning" | "error" | "info" | "light"
> = {
  DRAFT: "light",
  SUBMITTED: "info",
  UNDER_REVIEW: "warning",
  MORE_INFO_REQUIRED: "warning",
  APPROVED: "success",
  REJECTED: "error",
  SANCTIONED: "info",
  CUSTOMER_ACCEPTED: "info",
  AGREEMENT_SIGNED: "info",
  DISBURSEMENT_PENDING: "warning",
  DISBURSED: "success",
};

export function ApplicationStatusBadge({
  status,
}: {
  status: ApplicationStatus;
}) {
  return (
    <Badge size="sm" color={APPLICATION_TONE[status]}>
      {labelFor(APPLICATION_STATUS_OPTIONS, status)}
    </Badge>
  );
}

export function ConfigStatusBadge({ status }: { status: LoanProductStatus }) {
  const tone =
    status === "ACTIVE" ? "success" : status === "DRAFT" ? "light" : "error";

  return (
    <Badge size="sm" color={tone}>
      {labelFor(LOAN_CONFIG_STATUS_OPTIONS, status)}
    </Badge>
  );
}

/**
 * Named for the application document it describes, not just "document": the
 * customers feature exports its own `DocumentStatusBadge` over
 * `DocumentVerificationStatus`, and the two are different domain concepts. A
 * shared name made the two feature barrels impossible to import together.
 */
export function ApplicationDocumentStatusBadge({
  status,
}: {
  status: ApplicationDocumentStatus;
}) {
  const tone =
    status === "VERIFIED"
      ? "success"
      : status === "REJECTED"
        ? "error"
        : "warning";

  return (
    <Badge size="sm" color={tone}>
      {labelFor(DOCUMENT_VERIFICATION_STATUS_OPTIONS, status)}
    </Badge>
  );
}

/**
 * The formatters now live in `@/lib/format`, re-exported here so this module's
 * public surface — and the loans barrel's — is unchanged.
 *
 * They moved because they carry no loan semantics (they are string formatting
 * over integers) and three features render the same amounts. Crucially,
 * `disbursements`' client components cannot reach them through the loans
 * barrel: every feature barrel re-exports its `server-only` `api/` module, so a
 * client import through the barrel fails the build. `lib/` has no such
 * constraint.
 */
export { formatBps, formatDate, formatPaise } from "@/lib/format";

/**
 * The label maps that used to live here now come from `@lms/validation`, built
 * from the same zod enums that validate these fields. Import the registries (or
 * `labelFor`) directly rather than reaching for a map through this module.
 */
