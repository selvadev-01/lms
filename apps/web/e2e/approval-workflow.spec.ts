import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  STORAGE_STATE,
  apiAs,
  attachRequiredDocuments,
  throttled,
} from "./support/session";

/**
 * Module 08 — Approval Workflow: credit assessment, sanction, customer
 * response and agreement signing.
 *
 * **Fixture ownership.** Every application here is minted by this spec against
 * CUST001 and carries its own scratch marker, distinct from
 * `loan-applications.spec.ts`'s. The sweep can only reach the drafts, because
 * an application past DRAFT is undeletable by design — the rest stay as
 * history, which is the rule working.
 *
 * **Why single-worker.** Three separate contentions, any one of which would be
 * enough: applications are numbered `APP-000001` upward from a per-organization
 * sequence; sanction letters are numbered `SL-000001` upward from a second one;
 * and everything is built on CUST001, which `customers.spec.ts` mutates. It
 * also drives applications all the way to AGREEMENT_SIGNED, a state
 * `loan-applications.spec.ts` would race if the two ran together.
 * `playwright.config.ts` puts this file in the `rbac` project for that reason.
 *
 * **What is actually being proved.** Things a unit test against a mock cannot:
 *
 * - A customer's decline landing on the unified `REJECTED` with its reason
 *   preserved (Scenario 32, Rule 13), against a real enum in a real database
 *   that also offers `CUSTOMER_REJECTED`.
 * - The approval gates refusing through the real permission stack — no
 *   assessment, a FAILED assessment, a missing document (Scenarios 6, 8, 9).
 * - A Branch Admin who reaches an approved application, is denied issuing its
 *   sanction letter, and *is* allowed to record the customer's response —
 *   proving the fourth withheld grant is withheld and the other three are not.
 * - Two concurrent responses on one letter committing exactly once.
 * - The `SL-` sequence allocating against a real unique index.
 */

test.describe.configure({ mode: "serial" });

/**
 * Above Playwright's 30s default because `attachRequiredDocuments` may wait out
 * a 60s upload-throttle window. Without this the wait would trip the test
 * timeout it exists to survive.
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

/** Distinct from `loan-applications.spec.ts`'s marker, so the sweeps cannot cross. */
const SCRATCH_MARKER = "APPZZ-m8-e2e";

interface ApplicationBody {
  applicationId: string;
  applicationNumber: string;
  status: string;
  version: string;
  purpose?: string;
  rejectionReason?: string;
  sanctionedAt?: string;
  agreementSignedAt?: string;
}

interface SanctionBody {
  sanctionLetterId: string;
  sanctionNumber: string;
  sanctionedAmountPaise: string;
  installmentAmountPaise: string;
  customerResponse: string;
  declineReason?: string;
  agreementReference?: string;
}

interface Terms {
  loanSchemeId: string;
  repaymentFrequency: string;
  durationCount: number;
  interestType: string;
  interestRateBps: string;
}

type Api = Awaited<ReturnType<typeof apiAs>>;

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

/** Read from the seed rather than hard-coded, so this follows it. */
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
  expect(schemes.length).toBeGreaterThan(0);

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
  expect(term).toBeTruthy();

  return {
    loanSchemeId: scheme.loanSchemeId,
    repaymentFrequency: term!.frequency,
    durationCount: term!.durationCount,
    interestType: scheme.interestType,
    interestRateBps: scheme.interestRateBps,
  };
}

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

/** Records an assessment. `result` decides whether approval will be allowed. */
async function assess(
  api: Api,
  applicationId: string,
  result: "PASS" | "FAIL" | "MANUAL_REVIEW",
): Promise<void> {
  const response = await api.post(
    `/loan-applications/${applicationId}/credit-assessment`,
    {
      cibilScore: result === "PASS" ? 780 : 480,
      incomeVerified: result === "PASS",
      assessmentResult: result,
      assessmentNotes: `${SCRATCH_MARKER} ${result}`,
    },
  );

  expect(response.status(), await response.text()).toBe(201);
}

/**
 * Drives an application to UNDER_REVIEW with its documents attached.
 *
 * Stops short of the assessment so each test decides what the finding is —
 * which is the variable most of them are about.
 */
async function driveToReview(
  request: APIRequestContext,
  api: Api,
  label: string,
): Promise<ApplicationBody> {
  const terms = await selectableTerms(api);
  const draft = await createDraft(api, await customerId(api), terms, label);

  await attachRequiredDocuments(request, SUPER_ADMIN, draft.applicationId);

  const afterDocuments = await current(api, draft.applicationId);
  const submitted = await throttled(() =>
    api.post(`/loan-applications/${draft.applicationId}/submit`, {
      expectedVersion: afterDocuments.version,
    }),
  );
  expect(submitted.status(), await submitted.text()).toBe(200);

  const afterSubmit = await current(api, draft.applicationId);
  const reviewing = await throttled(() =>
    api.post(`/loan-applications/${draft.applicationId}/start-review`, {
      expectedVersion: afterSubmit.version,
    }),
  );
  expect(reviewing.status(), await reviewing.text()).toBe(200);

  return current(api, draft.applicationId);
}

/** Review, a PASS assessment, and approval — the state sanction starts from. */
async function driveToApproved(
  request: APIRequestContext,
  api: Api,
  label: string,
): Promise<ApplicationBody> {
  const reviewing = await driveToReview(request, api, label);
  await assess(api, reviewing.applicationId, "PASS");

  const approved = await api.post(
    `/loan-applications/${reviewing.applicationId}/approve`,
    { expectedVersion: reviewing.version },
  );
  expect(approved.status(), await approved.text()).toBe(200);

  return current(api, reviewing.applicationId);
}

/** Approved, plus an issued letter. */
async function driveToSanctioned(
  request: APIRequestContext,
  api: Api,
  label: string,
): Promise<ApplicationBody> {
  const approved = await driveToApproved(request, api, label);

  const issued = await api.post(
    `/loan-applications/${approved.applicationId}/sanction`,
    { expectedVersion: approved.version },
  );
  expect(issued.status(), await issued.text()).toBe(200);

  return current(api, approved.applicationId);
}

test.afterAll(async ({ request }) => {
  // Only the drafts. Everything this spec drives past DRAFT is undeletable by
  // design, so the sweep must not treat those as failures — it simply cannot
  // reach them, and that is the rule holding rather than a leak.
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

test.describe("credit assessment gates approval", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenario 8 — approval is refused until an assessment exists", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const reviewing = await driveToReview(request, api, "no-assessment");

    const blocked = await api.post(
      `/loan-applications/${reviewing.applicationId}/approve`,
      { expectedVersion: reviewing.version },
    );

    expect(blocked.status()).toBe(409);
    const body = (await blocked.json()) as { reason?: string };
    expect(body.reason).toBe("ASSESSMENT_MISSING");

    // Unchanged, not half-approved.
    expect((await current(api, reviewing.applicationId)).status).toBe(
      "UNDER_REVIEW",
    );

    // And it goes through once the assessment is there.
    await assess(api, reviewing.applicationId, "PASS");
    const after = await current(api, reviewing.applicationId);
    const approved = await api.post(
      `/loan-applications/${reviewing.applicationId}/approve`,
      { expectedVersion: after.version },
    );

    expect(approved.status(), await approved.text()).toBe(200);
    expect((await current(api, reviewing.applicationId)).status).toBe(
      "APPROVED",
    );
  });

  /** The one that matters most: a failed check must never become a pass. */
  test("Scenario 9 — a FAILED assessment blocks approval", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const reviewing = await driveToReview(request, api, "failed-assessment");
    await assess(api, reviewing.applicationId, "FAIL");

    const refreshed = await current(api, reviewing.applicationId);
    const blocked = await api.post(
      `/loan-applications/${reviewing.applicationId}/approve`,
      { expectedVersion: refreshed.version },
    );

    expect(blocked.status()).toBe(409);
    const body = (await blocked.json()) as { reason?: string };
    expect(body.reason).toBe("ASSESSMENT_NOT_PASSED");
    expect((await current(api, reviewing.applicationId)).status).toBe(
      "UNDER_REVIEW",
    );
  });

  test("an ambiguous MANUAL_REVIEW blocks approval as firmly as a failure", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const reviewing = await driveToReview(request, api, "manual-review");
    await assess(api, reviewing.applicationId, "MANUAL_REVIEW");

    const refreshed = await current(api, reviewing.applicationId);
    const blocked = await api.post(
      `/loan-applications/${reviewing.applicationId}/approve`,
      { expectedVersion: refreshed.version },
    );

    expect(blocked.status()).toBe(409);

    // A fresh PASS supersedes it and unblocks — that is the override, and the
    // superseded MANUAL_REVIEW stays as the record of it.
    await assess(api, reviewing.applicationId, "PASS");
    const history = await api.get(
      `/loan-applications/${reviewing.applicationId}/credit-assessment`,
    );
    const assessments = (await history.json()) as {
      current: { assessmentResult: string };
      superseded: Array<{ assessmentResult: string }>;
    };

    expect(assessments.current.assessmentResult).toBe("PASS");
    expect(assessments.superseded.map((a) => a.assessmentResult)).toContain(
      "MANUAL_REVIEW",
    );
  });

  test("Scenario 6 — approval names the missing documents", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const terms = await selectableTerms(api);
    const draft = await createDraft(
      api,
      await customerId(api),
      terms,
      "no-documents",
    );

    // Submitted with documents, then one is rejected by a verifier — which
    // reopens the requirement without reopening the application.
    await attachRequiredDocuments(request, SUPER_ADMIN, draft.applicationId);
    const withDocuments = await current(api, draft.applicationId);
    await api.post(`/loan-applications/${draft.applicationId}/submit`, {
      expectedVersion: withDocuments.version,
    });
    const submitted = await current(api, draft.applicationId);
    await api.post(`/loan-applications/${draft.applicationId}/start-review`, {
      expectedVersion: submitted.version,
    });

    const documents = await api.get(
      `/loan-applications/${draft.applicationId}/documents`,
    );
    const { documents: rows } = (await documents.json()) as {
      documents: Array<{ applicationDocumentId: string; documentType: string }>;
    };
    const income = rows.find((row) => row.documentType === "INCOME");
    expect(income).toBeTruthy();

    const rejected = await api.post(
      `/loan-applications/${draft.applicationId}/documents/${income!.applicationDocumentId}/verify`,
      { status: "REJECTED", reason: "Illegible" },
    );
    // Asserted rather than fired and forgotten: a silently-failed rejection
    // would leave the document VERIFIED-pending and make the approval below
    // succeed, turning this into a test that passes for the wrong reason.
    expect(rejected.ok(), await rejected.text()).toBe(true);

    await assess(api, draft.applicationId, "PASS");

    const reviewing = await current(api, draft.applicationId);
    const blocked = await api.post(
      `/loan-applications/${draft.applicationId}/approve`,
      { expectedVersion: reviewing.version },
    );

    expect(blocked.status()).toBe(409);
    const body = (await blocked.json()) as {
      missingDocumentTypes?: string[];
    };
    expect(body.missingDocumentTypes).toContain("INCOME");
  });

  /** Structural, not a gate: MORE_INFO_REQUIRED is in no `from` list. */
  test("Scenario 13 — approval is refused while information is outstanding", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const reviewing = await driveToReview(request, api, "more-info");
    await assess(api, reviewing.applicationId, "PASS");

    const refreshed = await current(api, reviewing.applicationId);
    await api.post(
      `/loan-applications/${reviewing.applicationId}/request-info`,
      { comments: "Need a payslip", expectedVersion: refreshed.version },
    );

    const outstanding = await current(api, reviewing.applicationId);
    expect(outstanding.status).toBe("MORE_INFO_REQUIRED");

    const blocked = await api.post(
      `/loan-applications/${reviewing.applicationId}/approve`,
      { expectedVersion: outstanding.version },
    );

    expect(blocked.status()).toBe(409);
  });
});

test.describe("sanction", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenario 30 — the letter carries the approved terms and an SL- number", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const sanctioned = await driveToSanctioned(request, api, "issue");

    expect(sanctioned.status).toBe("SANCTIONED");
    expect(sanctioned.sanctionedAt).toBeTruthy();

    const letter = await api.get(
      `/loan-applications/${sanctioned.applicationId}/sanction`,
    );
    expect(letter.ok()).toBe(true);
    const body = (await letter.json()) as SanctionBody;

    expect(body.sanctionNumber).toMatch(/^SL-\d{6}$/);
    // Snapshotted from the application, not supplied by the caller.
    expect(body.sanctionedAmountPaise).toBe("10000000");
    // Compared as a number, not a BigInt literal: the e2e tsconfig targets
    // below ES2020, and an installment is far inside the safe integer range.
    expect(Number(body.installmentAmountPaise)).toBeGreaterThan(0);
    expect(body.customerResponse).toBe("PENDING");
  });

  test("Scenario 31 — sanction cannot bypass approval", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const reviewing = await driveToReview(request, api, "bypass");

    const refused = await api.post(
      `/loan-applications/${reviewing.applicationId}/sanction`,
      { expectedVersion: reviewing.version },
    );

    expect(refused.status()).toBe(409);
    expect((await current(api, reviewing.applicationId)).status).toBe(
      "UNDER_REVIEW",
    );

    // And no letter was left behind.
    const letter = await api.get(
      `/loan-applications/${reviewing.applicationId}/sanction`,
    );
    expect(letter.status()).toBe(404);
  });

  test("a second letter is refused", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const sanctioned = await driveToSanctioned(request, api, "reissue");

    const again = await api.post(
      `/loan-applications/${sanctioned.applicationId}/sanction`,
      { expectedVersion: sanctioned.version },
    );

    expect(again.status()).toBe(409);
  });

  test("a stale version is refused", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const approved = await driveToApproved(request, api, "stale");

    const refused = await api.post(
      `/loan-applications/${approved.applicationId}/sanction`,
      { expectedVersion: "2020-01-01T00:00:00.000Z" },
    );

    expect(refused.status()).toBe(409);
    expect((await current(api, approved.applicationId)).status).toBe(
      "APPROVED",
    );
  });
});

test.describe("customer response and agreement", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenario 33 — acceptance then a signed agreement", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const sanctioned = await driveToSanctioned(request, api, "accept");

    const accepted = await api.post(
      `/loan-applications/${sanctioned.applicationId}/sanction/accept`,
      { expectedVersion: sanctioned.version },
    );
    expect(accepted.status(), await accepted.text()).toBe(200);

    const afterAccept = await current(api, sanctioned.applicationId);
    expect(afterAccept.status).toBe("CUSTOMER_ACCEPTED");

    const signed = await api.post(
      `/loan-applications/${sanctioned.applicationId}/agreement`,
      {
        agreementReference: "AGR-E2E-0001",
        expectedVersion: afterAccept.version,
      },
    );
    expect(signed.status(), await signed.text()).toBe(200);

    const final = await current(api, sanctioned.applicationId);
    expect(final.status).toBe("AGREEMENT_SIGNED");
    expect(final.agreementSignedAt).toBeTruthy();

    const letter = await api.get(
      `/loan-applications/${sanctioned.applicationId}/sanction`,
    );
    const body = (await letter.json()) as SanctionBody;
    expect(body.customerResponse).toBe("ACCEPTED");
    expect(body.agreementReference).toBe("AGR-E2E-0001");
  });

  test("an agreement cannot be recorded before the customer accepts", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const sanctioned = await driveToSanctioned(request, api, "skip-accept");

    const refused = await api.post(
      `/loan-applications/${sanctioned.applicationId}/agreement`,
      { expectedVersion: sanctioned.version },
    );

    expect(refused.status()).toBe(409);
    expect((await current(api, sanctioned.applicationId)).status).toBe(
      "SANCTIONED",
    );
  });

  /**
   * Rule 13, end to end.
   *
   * The database's `application_status` enum *does* offer `CUSTOMER_REJECTED`.
   * This asserts the unified status is what actually lands, with the decline
   * reason preserved as the rejection reason and the review entry's SANCTION
   * type carrying the distinction instead.
   */
  test("Scenario 32 — a decline lands on the unified REJECTED", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const sanctioned = await driveToSanctioned(request, api, "decline");

    const declined = await api.post(
      `/loan-applications/${sanctioned.applicationId}/sanction/decline`,
      {
        declineReason: "Customer found cheaper credit",
        expectedVersion: sanctioned.version,
      },
    );
    expect(declined.status(), await declined.text()).toBe(200);

    const after = await current(api, sanctioned.applicationId);
    expect(after.status).toBe("REJECTED");
    expect(after.status).not.toBe("CUSTOMER_REJECTED");
    expect(after.rejectionReason).toBe("Customer found cheaper credit");

    const letter = await api.get(
      `/loan-applications/${sanctioned.applicationId}/sanction`,
    );
    const body = (await letter.json()) as SanctionBody;
    expect(body.customerResponse).toBe("DECLINED");
    expect(body.declineReason).toBe("Customer found cheaper credit");

    // The newest history entry is what tells this apart from an admin's
    // rejection, since both wear the same status.
    const history = await api.get(
      `/loan-applications/${sanctioned.applicationId}/history`,
    );
    const { history: entries } = (await history.json()) as {
      history: Array<{ reviewType: string; decision: string }>;
    };
    const newest = entries[entries.length - 1]!;
    expect(newest.reviewType).toBe("SANCTION");
    expect(newest.decision).toBe("REJECTED");
  });

  /**
   * Two responses racing one letter. Needs a real database arbitrating two real
   * requests — the application's status guard and the letter's own guard must
   * agree on which one won.
   */
  test("concurrent accept and decline commit exactly once", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const sanctioned = await driveToSanctioned(request, api, "race");

    const [accept, decline] = await Promise.all([
      api.post(
        `/loan-applications/${sanctioned.applicationId}/sanction/accept`,
        { expectedVersion: sanctioned.version },
      ),
      api.post(
        `/loan-applications/${sanctioned.applicationId}/sanction/decline`,
        {
          declineReason: "Racing decline",
          expectedVersion: sanctioned.version,
        },
      ),
    ]);

    const codes = [accept.status(), decline.status()].sort();
    expect(codes).toEqual([200, 409]);

    const after = await current(api, sanctioned.applicationId);
    expect(["CUSTOMER_ACCEPTED", "REJECTED"]).toContain(after.status);
  });
});

test.describe("Branch Admin authority", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  /**
   * The fourth withheld grant, and the three that are not.
   *
   * The seed keeps `loans.applications.sanction.issue` with the Super Admin on
   * the same reasoning as `override_rate`: issuing the letter commits the
   * organization to terms one step from the approval this role was already
   * denied. Recording what the customer answered is transcription, so the
   * Branch Admin holds that. If either half of this test stops holding, the
   * seed's omission block has been edited.
   */
  test("is denied issuing a sanction letter but may record the response", async ({
    request,
  }) => {
    const superAdmin = await apiAs(request, SUPER_ADMIN);
    const approved = await driveToApproved(request, superAdmin, "branch-admin");

    const branchAdmin = await apiAs(request, BRANCH_ADMIN);

    // Reaches it — this is a denial of the action, not of the record.
    const readable = await branchAdmin.get(
      `/loan-applications/${approved.applicationId}`,
    );
    expect(readable.ok()).toBe(true);

    const refused = await branchAdmin.post(
      `/loan-applications/${approved.applicationId}/sanction`,
      { expectedVersion: approved.version },
    );
    expect(refused.status()).toBe(403);
    expect((await current(superAdmin, approved.applicationId)).status).toBe(
      "APPROVED",
    );

    // The Super Admin issues it; the Branch Admin records the answer.
    const issued = await superAdmin.post(
      `/loan-applications/${approved.applicationId}/sanction`,
      { expectedVersion: approved.version },
    );
    expect(issued.status(), await issued.text()).toBe(200);

    const sanctioned = await current(superAdmin, approved.applicationId);
    const accepted = await branchAdmin.post(
      `/loan-applications/${approved.applicationId}/sanction/accept`,
      { expectedVersion: sanctioned.version },
    );

    expect(accepted.status(), await accepted.text()).toBe(200);
    expect((await current(superAdmin, approved.applicationId)).status).toBe(
      "CUSTOMER_ACCEPTED",
    );
  });

  test("may record a credit assessment", async ({ request }) => {
    const superAdmin = await apiAs(request, SUPER_ADMIN);
    const reviewing = await driveToReview(request, superAdmin, "ba-assess");

    const branchAdmin = await apiAs(request, BRANCH_ADMIN);
    const recorded = await branchAdmin.post(
      `/loan-applications/${reviewing.applicationId}/credit-assessment`,
      {
        cibilScore: 720,
        incomeVerified: true,
        assessmentResult: "PASS",
        assessmentNotes: `${SCRATCH_MARKER} branch admin`,
      },
    );

    expect(recorded.status(), await recorded.text()).toBe(201);
  });

  /**
   * Scenarios 3, 4, on the endpoint where the disclosure would cost the most.
   *
   * A synthetic id rather than a hunt for a genuinely out-of-branch row: the
   * seed puts every application in the Branch Admin's own branch, so such a row
   * does not reliably exist and a test that skipped itself when it could not
   * find one would be silent coverage rather than coverage. An unreachable id
   * is an unreachable id — the service answers on reachability, not on why.
   *
   * 404 and never 403, because a 403 confirms the id exists. That matters more
   * here than on the application itself: this endpoint carries a CIBIL score.
   */
  test("an unreachable application answers not-found for its assessment", async ({
    request,
  }) => {
    const branchAdmin = await apiAs(request, BRANCH_ADMIN);

    const response = await branchAdmin.get(
      "/loan-applications/00000000-0000-4000-8000-000000000000/credit-assessment",
    );

    expect(response.status()).toBe(404);
  });
});
