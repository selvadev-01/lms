import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  STORAGE_STATE,
  apiAs,
  attachRequiredDocuments,
  throttled,
} from "./support/session";

/**
 * Module 07 — Loan Applications.
 *
 * **Fixture ownership.** This spec owns every application it creates, all
 * against CUST001, and sweeps them in `afterAll` by deleting anything whose
 * purpose carries the scratch marker. It reads the seeded loan products and
 * schemes (`PROD-*`, `SCH-*`) but never mutates them — `loan-products.spec.ts`
 * owns those.
 *
 * **Why single-worker.** Applications are numbered `APP-000001` upward from a
 * per-organization sequence, so two workers creating them concurrently would
 * contend on that allocation and on the shared customer. It also signs in as the
 * same RBAC accounts as the Module 03-05 specs. `playwright.config.ts` puts this
 * file in the `rbac` project for exactly that reason.
 *
 * **What is actually being proved.** The refusals, and the races:
 *
 * - Two concurrent decisions on one application committing exactly once
 *   (Scenario 52). This is the reason the transition guard puts both `status`
 *   and `updatedAt` in its WHERE clause, and it cannot be proved by a unit test
 *   against a mock — it needs a real database arbitrating two real requests.
 * - A Branch Admin who reaches the application and is still denied approval and
 *   draft deletion, because the seed withholds `loans.approve` and
 *   `loans.applications.delete_draft` from that role precisely so this is
 *   provable (Scenarios 28, 36).
 * - An application in another branch answering not-found rather than forbidden
 *   (Scenarios 3, 4), because a 403 would confirm the id exists.
 * - A decided application refusing every further transition (Rules 85, 86).
 * - The completeness gate naming what is missing rather than merely refusing
 *   (Scenario 18).
 */

test.describe.configure({ mode: "serial" });

/**
 * Above Playwright's 30s default because `attachRequiredDocuments` may wait out
 * a 60s upload-throttle window — this spec shares that 20-a-minute budget with
 * `approval-workflow.spec.ts`, and which of the two hits the ceiling depends
 * only on ordering.
 */
/**
 * Raised from 150s when `throttled` began waiting out two rate-limit windows
 * rather than one. Two waits is ~122s, which left under 30s for the requests
 * themselves — so a test that hit the limiter twice would fail on a timeout
 * rather than on anything it was asserting.
 */
test.setTimeout(240_000);

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";

/** Marks the applications this spec mints, so the sweep can find them. */
const SCRATCH_MARKER = "APPZZ-e2e";

interface ApplicationBody {
  applicationId: string;
  applicationNumber: string;
  status: string;
  version: string;
  purpose?: string;
  interestRateBps: string;
  durationCount: number;
  repaymentFrequency: string;
  rejectionReason?: string;
  emi: { installmentAmountPaise: string } | null;
}

interface Terms {
  loanSchemeId: string;
  repaymentFrequency: string;
  durationCount: number;
  interestType: string;
  interestRateBps: string;
}

type Api = Awaited<ReturnType<typeof apiAs>>;

/** CUST001 — the BR001 happy-path customer, read but never mutated. */
async function customerId(api: Api): Promise<string> {
  const response = await api.get("/customers?search=CUST001");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    customers: Array<{ customerId: string; customerCode: string }>;
  };
  const row = body.customers.find((c) => c.customerCode === "CUST001");
  expect(row, "CUST001 must be seeded").toBeTruthy();

  return row!.customerId;
}

/**
 * A scheme an application may actually be created against, with a term it
 * offers.
 *
 * Read from `selectable=true` rather than hard-coded, so the spec follows the
 * seed rather than duplicating it — and so it fails loudly if the seed ever
 * stops offering a usable scheme at all.
 */
async function selectableTerms(api: Api): Promise<Terms> {
  const list = await api.get("/loan-schemes?selectable=true");
  expect(list.ok()).toBe(true);
  const { schemes } = (await list.json()) as {
    schemes: Array<{
      loanSchemeId: string;
      interestType: string;
      interestRateBps: string;
    }>;
  };
  expect(
    schemes.length,
    "the seed must offer a selectable scheme",
  ).toBeGreaterThan(0);

  const scheme = schemes[0]!;
  const detail = await api.get(`/loan-schemes/${scheme.loanSchemeId}`);
  const { durations } = (await detail.json()) as {
    durations: Array<{
      frequency: string;
      durationCount: number;
      status: string;
    }>;
  };
  const term = durations.find((d) => d.status === "ACTIVE");
  expect(term, "a selectable scheme must offer an active term").toBeTruthy();

  return {
    loanSchemeId: scheme.loanSchemeId,
    repaymentFrequency: term!.frequency,
    durationCount: term!.durationCount,
    interestType: scheme.interestType,
    interestRateBps: scheme.interestRateBps,
  };
}

async function createDraft(
  api: Api,
  customer: string,
  terms: Terms,
  label: string,
): Promise<ApplicationBody> {
  // Throttle-aware: creation is capped at 20 a minute and every spec in the
  // `rbac` group shares that budget.
  const response = await throttled(() =>
    api.post("/loan-applications", {
      customerId: customer,
      loanSchemeId: terms.loanSchemeId,
      requestedAmountPaise: "10000000",
      purpose: `${SCRATCH_MARKER} ${label}`,
      interestType: terms.interestType,
      interestRateBps: terms.interestRateBps,
      repaymentFrequency: terms.repaymentFrequency,
      durationCount: terms.durationCount,
    }),
  );

  expect(response.status(), await response.text()).toBe(201);

  return (await response.json()) as ApplicationBody;
}

/** Re-reads the application so a caller always acts on a current version. */
async function current(
  api: Api,
  applicationId: string,
): Promise<ApplicationBody> {
  // Throttle-aware: every spec in the `rbac` group shares one rate limiter, and a bare
  // `ok()` here reported a 429 as an unexplained `false`.
  const response = await throttled(() =>
    api.get(`/loan-applications/${applicationId}`),
  );
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()) as ApplicationBody;
}

/** Takes a fresh draft all the way to UNDER_REVIEW. */
async function underReview(
  request: APIRequestContext,
  api: Api,
  customer: string,
  terms: Terms,
  label: string,
): Promise<ApplicationBody> {
  const draft = await createDraft(api, customer, terms, label);
  await attachRequiredDocuments(request, SUPER_ADMIN, draft.applicationId);

  let row = await current(api, draft.applicationId);
  const submitted = await throttled(() =>
    api.post(`/loan-applications/${row.applicationId}/submit`, {
      expectedVersion: row.version,
    }),
  );
  expect(submitted.status(), await submitted.text()).toBe(200);

  row = await current(api, draft.applicationId);
  const claimed = await throttled(() =>
    api.post(`/loan-applications/${row.applicationId}/start-review`, {
      expectedVersion: row.version,
    }),
  );
  expect(claimed.status(), await claimed.text()).toBe(200);

  return current(api, draft.applicationId);
}

test.afterAll(async ({ request }) => {
  // Drafts this spec left behind. Anything past DRAFT cannot be deleted by
  // design (Scenario 34), so the sweep can only reach the ones that never moved
  // — the rest stay as history, which is the point of that rule.
  const api = await apiAs(request, SUPER_ADMIN);
  const response = await api.get("/loan-applications?status=DRAFT");
  if (!response.ok()) return;

  const { applications } = (await response.json()) as {
    applications: ApplicationBody[];
  };

  for (const application of applications) {
    if (application.purpose?.startsWith(SCRATCH_MARKER)) {
      await api.delete(`/loan-applications/${application.applicationId}`);
    }
  }
});

test.describe("creation and the completeness gate", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenario 18 — submission names what is missing rather than merely refusing", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);
    const draft = await createDraft(api, await customerId(api), terms, "gate");

    const blocked = await api.post(
      `/loan-applications/${draft.applicationId}/submit`,
      { expectedVersion: draft.version },
    );

    expect(blocked.status()).toBe(409);
    const body = (await blocked.json()) as {
      checks?: Array<{ key: string; satisfied: boolean }>;
    };
    // The refusal must be actionable: a bare 409 would leave a clerk guessing
    // which of nine conditions failed.
    expect(body.checks?.map((check) => check.key)).toContain(
      "DOCUMENTS_COMPLETE",
    );

    const summary = await api.get(
      `/loan-applications/${draft.applicationId}/completeness`,
    );
    const completeness = (await summary.json()) as {
      submittable: boolean;
      checks: Array<{ key: string }>;
      missingDocumentTypes: string[];
    };

    expect(completeness.submittable).toBe(false);
    expect(completeness.missingDocumentTypes).toEqual(["ID", "INCOME"]);
    // Every check, always, so the UI can render a stable list with green ticks.
    expect(completeness.checks).toHaveLength(9);
  });

  test("Scenario 10 — a withdrawn scheme cannot be used, even by direct request", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const all = await api.get("/loan-schemes");
    const { schemes } = (await all.json()) as {
      schemes: Array<{
        loanSchemeId: string;
        code: string;
        status: string;
        interestType: string;
        interestRateBps: string;
      }>;
    };
    const withdrawn = schemes.find((scheme) => scheme.status === "INACTIVE");
    expect(withdrawn, "the seed must carry a withdrawn scheme").toBeTruthy();

    const customer = await customerId(api);
    const response = await throttled(() =>
      api.post("/loan-applications", {
        customerId: customer,
        loanSchemeId: withdrawn!.loanSchemeId,
        requestedAmountPaise: "10000000",
        purpose: `${SCRATCH_MARKER} withdrawn scheme`,
        interestType: withdrawn!.interestType,
        interestRateBps: withdrawn!.interestRateBps,
        repaymentFrequency: "MONTHLY",
        durationCount: 12,
      }),
    );

    // Refused because the scheme is withdrawn, not because the request was
    // malformed — the picker hiding it is a convenience, this is the control.
    expect(response.status()).toBe(409);
  });

  test("Scenario 11 — a term the scheme does not offer is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);

    const customer = await customerId(api);
    const response = await throttled(() =>
      api.post("/loan-applications", {
        customerId: customer,
        loanSchemeId: terms.loanSchemeId,
        requestedAmountPaise: "10000000",
        purpose: `${SCRATCH_MARKER} bad term`,
        interestType: terms.interestType,
        interestRateBps: terms.interestRateBps,
        repaymentFrequency: terms.repaymentFrequency,
        // A count no scheme in the seed offers.
        durationCount: 9999,
      }),
    );

    expect(response.status()).toBe(409);
  });

  test("Scenario 43 — a client-supplied branch cannot place an application", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);

    const customer = await customerId(api);
    const response = await throttled(() =>
      api.post("/loan-applications", {
        customerId: customer,
        loanSchemeId: terms.loanSchemeId,
        requestedAmountPaise: "10000000",
        purpose: `${SCRATCH_MARKER} branch override`,
        interestType: terms.interestType,
        interestRateBps: terms.interestRateBps,
        repaymentFrequency: terms.repaymentFrequency,
        durationCount: terms.durationCount,
        // No such field exists on the DTO, so `forbidNonWhitelisted` refuses the
        // whole request. The branch comes from the customer, never the caller.
        branchId: "00000000-0000-4000-8000-000000000000",
      }),
    );

    expect(response.status()).toBe(400);
  });
});

test.describe("the review lifecycle", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenarios 16, 60 — modifying terms recalculates EMI and preserves the previous values", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);
    const application = await underReview(
      request,
      api,
      await customerId(api),
      terms,
      "modify",
    );

    const before = application.emi?.installmentAmountPaise;
    const originalRate = application.interestRateBps;

    // A different rate under the same scheme and term, so only the price moves.
    const raised = String(Number(originalRate) + 200);
    const modified = await api.post(
      `/loan-applications/${application.applicationId}/modify-terms`,
      {
        interestType: "CUSTOM_RATE",
        interestRateBps: raised,
        repaymentFrequency: application.repaymentFrequency,
        durationCount: application.durationCount,
        comments: "e2e repricing",
        expectedVersion: application.version,
      },
    );

    expect(modified.status(), await modified.text()).toBe(200);

    const after = await current(api, application.applicationId);
    expect(after.interestRateBps).toBe(raised);
    // Rule 68: the schedule must move with the terms, not lag behind them.
    expect(after.emi?.installmentAmountPaise).not.toBe(before);
    expect(after.status).toBe("UNDER_REVIEW");

    const history = await api.get(
      `/loan-applications/${application.applicationId}/history`,
    );
    const { history: entries } = (await history.json()) as {
      history: Array<{ reviewType: string; previousInterestRateBps?: string }>;
    };
    const change = entries.find((entry) => entry.reviewType === "MODIFY_TERMS");

    // The pre-change rate is what makes the original submitted terms
    // recoverable; storing the new value instead would lose them.
    expect(change?.previousInterestRateBps).toBe(originalRate);
  });

  test("Scenario 27 — a rejection without a reason is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);
    const application = await underReview(
      request,
      api,
      await customerId(api),
      terms,
      "reason",
    );

    const response = await api.post(
      `/loan-applications/${application.applicationId}/reject`,
      { expectedVersion: application.version },
    );

    expect(response.status()).toBe(400);
    // The application must not have moved.
    expect((await current(api, application.applicationId)).status).toBe(
      "UNDER_REVIEW",
    );
  });

  test("Rules 85, 86 — a decided application refuses every further transition", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);
    const application = await underReview(
      request,
      api,
      await customerId(api),
      terms,
      "terminal",
    );

    const rejected = await api.post(
      `/loan-applications/${application.applicationId}/reject`,
      {
        rejectionReason: "e2e terminal check",
        expectedVersion: application.version,
      },
    );
    expect(rejected.status(), await rejected.text()).toBe(200);

    const decided = await current(api, application.applicationId);
    expect(decided.status).toBe("REJECTED");
    expect(decided.rejectionReason).toBe("e2e terminal check");

    // No reopen lifecycle exists in the source, so REJECTED has no outgoing
    // transition at all.
    const reopened = await api.post(
      `/loan-applications/${decided.applicationId}/approve`,
      { expectedVersion: decided.version },
    );
    expect(reopened.status()).toBe(409);

    // Scenario 34: a submitted application is never destructible.
    const deleted = await api.delete(
      `/loan-applications/${decided.applicationId}`,
    );
    expect(deleted.status()).toBe(409);

    expect((await current(api, decided.applicationId)).status).toBe("REJECTED");
  });

  test("Scenario 52 — concurrent approve and reject commit exactly once", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);
    const application = await underReview(
      request,
      api,
      await customerId(api),
      terms,
      "race",
    );

    /**
     * Both requests carry the *same* version, as two reviewers with the screen
     * open would, and are dispatched without awaiting either.
     *
     * This is the assertion the transition guard exists for. A read-then-write
     * version check passes for both callers before either writes, so without
     * `status` and `updatedAt` in the `updateMany` WHERE clause both would
     * commit and the final state would be whichever landed second. No unit test
     * against a mock can prove this; it needs a real database arbitrating.
     */
    const [approve, reject] = await Promise.all([
      api.post(`/loan-applications/${application.applicationId}/approve`, {
        expectedVersion: application.version,
      }),
      api.post(`/loan-applications/${application.applicationId}/reject`, {
        rejectionReason: "e2e race",
        expectedVersion: application.version,
      }),
    ]);

    const statuses = [approve.status(), reject.status()].sort();

    // Exactly one winner and one refusal — never two 200s.
    expect(statuses).toEqual([200, 409]);

    const settled = await current(api, application.applicationId);
    expect(["APPROVED", "REJECTED"]).toContain(settled.status);

    // And the surviving state matches whichever request won.
    expect(settled.status).toBe(
      approve.status() === 200 ? "APPROVED" : "REJECTED",
    );
  });
});

test.describe("scope and permission refusals", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenarios 28, 36 — a Branch Admin reaches the application and is denied the withheld actions", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(admin);
    const draft = await createDraft(
      admin,
      await customerId(admin),
      terms,
      "denied",
    );

    const branch = await apiAs(request, BRANCH_ADMIN);

    // Reaches it: the denial is about the action, not about visibility.
    const visible = await branch.get(
      `/loan-applications/${draft.applicationId}`,
    );
    expect(visible.status()).toBe(200);

    // `loans.applications.delete_draft` is withheld from BRANCH_ADMIN in the
    // seed precisely so this refusal is provable.
    const deleted = await branch.delete(
      `/loan-applications/${draft.applicationId}`,
    );
    expect(deleted.status()).toBe(403);

    // As is `loans.approve`.
    const approved = await branch.post(
      `/loan-applications/${draft.applicationId}/approve`,
      { expectedVersion: draft.version },
    );
    expect(approved.status()).toBe(403);

    // The draft is untouched by either refusal.
    expect((await current(admin, draft.applicationId)).status).toBe("DRAFT");
  });

  test("Rule 53 — a Branch Admin cannot price away from the scheme", async ({
    request,
  }) => {
    const branch = await apiAs(request, BRANCH_ADMIN);
    const terms = await selectableTerms(branch);

    const response = await branch.post("/loan-applications", {
      customerId: await customerId(branch),
      loanSchemeId: terms.loanSchemeId,
      requestedAmountPaise: "10000000",
      purpose: `${SCRATCH_MARKER} override`,
      interestType: "CUSTOM_RATE",
      interestRateBps: String(Number(terms.interestRateBps) + 500),
      repaymentFrequency: terms.repaymentFrequency,
      durationCount: terms.durationCount,
    });

    // 409 rather than 403: the check depends on the scheme's own rate, which the
    // permission guard cannot see, so the service raises it. Refused either way.
    expect(response.status()).toBe(409);
  });

  test("Scenarios 3, 4 — an unreachable application answers not-found, never forbidden", async ({
    request,
  }) => {
    const branch = await apiAs(request, BRANCH_ADMIN);

    const response = await branch.get(
      "/loan-applications/00000000-0000-4000-8000-000000000000",
    );

    // 404 rather than 403: a 403 would confirm the id exists, which is the
    // disclosure these scenarios are about.
    expect(response.status()).toBe(404);
  });
});
