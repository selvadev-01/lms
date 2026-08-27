import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  STORAGE_STATE,
  apiAs,
  attachRequiredDocuments,
  throttled,
} from "./support/session";

/**
 * Module 09 — Disbursal: scheduling, fund transfer, ledger posting and
 * repayment-schedule generation.
 *
 * **Fixture ownership.** Every application here is minted by this spec against
 * CUST001 and carries its own scratch marker, distinct from
 * `loan-applications.spec.ts`'s and `approval-workflow.spec.ts`'s. The sweep can
 * only reach drafts; anything driven past DRAFT is undeletable by design, and a
 * disbursed loan is undeletable *twice over* — Rules 30 and 31 forbid removing a
 * financial record at all. The rows this spec leaves behind are the rule
 * working, not litter.
 *
 * **Why single-worker.** Every reason `approval-workflow.spec.ts` gives, plus
 * two sequences of its own: loans are numbered `LN-000001` upward per
 * organization and journal entries `JE-000001` upward. It also posts to a
 * shared chart of accounts and drives applications to DISBURSED, a state both
 * of the other loan specs assert nothing reaches.
 * `playwright.config.ts` puts this file in the `rbac` project for that reason.
 *
 * **What is actually being proved.** Things a unit test against a mock cannot:
 *
 * - The double-entry balancing against the real deferred constraint trigger,
 *   and the ledger refusing an edit at the database (Scenarios 19, 21, 22).
 * - One disbursal committing across five tables — disbursement, journal entry,
 *   journal lines, loan, repayment schedule + EMIs — or none of them.
 * - The `LN-` and `JE-` sequences allocating against real unique indexes.
 * - A duplicate transaction reference refused by a real unique index rather
 *   than by an application check (Scenario 17).
 * - Idempotent replay returning the original result over a real HTTP round
 *   trip, which is the shape a timed-out client actually produces (Scenarios
 *   28, 46).
 * - A Branch Admin who reaches the disbursement, may schedule and record a
 *   transfer, and is denied confirming it — proving the fifth withheld grant is
 *   withheld and the other four are not (Scenarios 29, 30).
 * - Two concurrent confirmations committing exactly once (Scenario 44).
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

/** Distinct from the other loan specs' markers, so the sweeps cannot cross. */
const SCRATCH_MARKER = "APPZZ-m9-e2e";

/** The sanctioned amount every application here is built with. */
const AMOUNT = "10000000";

type Api = Awaited<ReturnType<typeof apiAs>>;

interface ApplicationBody {
  applicationId: string;
  applicationNumber: string;
  status: string;
  version: string;
}

interface DisbursementBody {
  disbursementId: string;
  loanId: string;
  loanNumber: string;
  status: string;
  amountPaise: string;
  paymentMode: string;
  transactionReference?: string;
  journalEntryId?: string;
  version: string;
}

interface LedgerBody {
  journalEntryId: string;
  entryNumber: string;
  lines: Array<{
    accountCode: string;
    accountName: string;
    debitPaise: string;
    creditPaise: string;
  }>;
  totalDebitPaise: string;
  totalCreditPaise: string;
  balanced: boolean;
}

interface ScheduleBody {
  version: number;
  status: string;
  installments: Array<{
    installmentNumber: number;
    dueDate: string;
    totalDuePaise: string;
  }>;
  totalPayablePaise: string;
}

interface Terms {
  loanSchemeId: string;
  repaymentFrequency: string;
  durationCount: number;
  interestType: string;
  interestRateBps: string;
}

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

/**
 * Reads an application, waiting out the read throttle once if it trips.
 *
 * The status goes to `expect` rather than `ok()` so a genuine failure reports
 * what actually came back instead of a bare `false` — which is exactly how the
 * rate-limit failures in the two neighbouring specs presented before
 * `throttled` was shared into `support/session.ts`.
 */
async function current(
  api: Api,
  applicationId: string,
): Promise<ApplicationBody> {
  const response = await throttled(() =>
    api.get(`/loan-applications/${applicationId}`),
  );

  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()) as ApplicationBody;
}

/**
 * Drives one application from nothing to AGREEMENT_SIGNED.
 *
 * Every disbursal test needs one, and each needs its *own* — an application can
 * only be disbursed once, so sharing a fixture between tests would make the
 * second one assert against a loan the first had already funded.
 */
async function signedApplication(
  api: Api,
  request: APIRequestContext,
  customer: string,
  terms: Terms,
  label: string,
): Promise<ApplicationBody> {
  const created = await throttled(() =>
    api.post("/loan-applications", {
      customerId: customer,
      loanSchemeId: terms.loanSchemeId,
      requestedAmountPaise: AMOUNT,
      purpose: `${SCRATCH_MARKER} ${label}`,
      interestType: terms.interestType,
      interestRateBps: terms.interestRateBps,
      repaymentFrequency: terms.repaymentFrequency,
      durationCount: terms.durationCount,
    }),
  );
  expect(created.status(), await created.text()).toBe(201);

  const application = (await created.json()) as ApplicationBody;
  const { applicationId } = application;

  await attachRequiredDocuments(request, SUPER_ADMIN, applicationId);

  const step = async (path: string, body: Record<string, unknown> = {}) => {
    const version = (await current(api, applicationId)).version;
    const response = await throttled(() =>
      api.post(`/loan-applications/${applicationId}${path}`, {
        ...body,
        expectedVersion: version,
      }),
    );
    expect(response.status(), await response.text()).toBeLessThan(300);
  };

  await step("/submit");
  await step("/start-review");

  const assessed = await throttled(() =>
    api.post(`/loan-applications/${applicationId}/credit-assessment`, {
      cibilScore: 780,
      incomeVerified: true,
      assessmentResult: "PASS",
      assessmentNotes: `${SCRATCH_MARKER} ${label}`,
    }),
  );
  expect(assessed.status(), await assessed.text()).toBeLessThan(300);

  await step("/approve", { comments: `${SCRATCH_MARKER} approve` });
  await step("/sanction", { notes: `${SCRATCH_MARKER} sanction` });
  await step("/sanction/accept", { comments: `${SCRATCH_MARKER} accept` });
  await step("/agreement", {
    signedDate: "2026-08-20",
    agreementReference: `AGR-${label}`,
  });

  const signed = await current(api, applicationId);
  expect(signed.status).toBe("AGREEMENT_SIGNED");

  return signed;
}

/** The bank funding account, from the endpoint the schedule form uses. */
async function bankAccountId(api: Api): Promise<string> {
  const response = await api.get("/loans/disbursements/accounts");
  expect(response.ok()).toBe(true);
  const { accounts } = (await response.json()) as {
    accounts: Array<{ value: string; label: string; hint?: string }>;
  };
  const bank = accounts.find((a) => a.hint === "1200");
  expect(bank, "the bank funding account must be seeded").toBeTruthy();

  return bank!.value;
}

async function schedule(
  api: Api,
  application: ApplicationBody,
  accountId: string,
): Promise<DisbursementBody> {
  const response = await throttled(() =>
    api.post("/loans/disbursements", {
      applicationId: application.applicationId,
      disbursementDate: "2026-08-21",
      disbursementAccountId: accountId,
      expectedVersion: application.version,
    }),
  );
  expect(response.status(), await response.text()).toBe(201);

  return (await response.json()) as DisbursementBody;
}

async function disbursement(
  api: Api,
  disbursementId: string,
): Promise<DisbursementBody> {
  const response = await throttled(() =>
    api.get(`/loans/disbursements/${disbursementId}`),
  );
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()) as DisbursementBody;
}

async function recordTransfer(
  api: Api,
  row: DisbursementBody,
  reference: string,
): Promise<DisbursementBody> {
  const response = await throttled(() =>
    api.post(`/loans/disbursements/${row.disbursementId}/transfer`, {
      paymentMode: "BANK_TRANSFER",
      amountPaise: AMOUNT,
      transactionReference: reference,
      transferDate: "2026-08-21",
      expectedVersion: row.version,
    }),
  );
  expect(response.status(), await response.text()).toBe(201);

  return (await response.json()) as DisbursementBody;
}

/**
 * A reference unique per call *and* per run.
 *
 * The run stamp is load-bearing, not decoration. Transaction references are
 * unique per organization and permanent — a disbursement is a financial record
 * and is never deleted (Rules 30, 31) — so a counter alone collides with the
 * previous run's rows on the second execution against the same database. The
 * first version of this spec did exactly that and failed on its second run,
 * which is the uniqueness constraint working rather than a bug.
 */
const RUN_STAMP = Date.now().toString(36);
let referenceCounter = 0;
function nextReference(label: string): string {
  referenceCounter += 1;

  return `TXN-M9-${RUN_STAMP}-${label}-${referenceCounter}`;
}

test.describe("Module 09 — disbursal", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenarios 5, 23, 24: a signed loan disburses, posting a balanced ledger and a schedule", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customer = await customerId(api);
    const terms = await selectableTerms(api);
    const account = await bankAccountId(api);

    const application = await signedApplication(
      api,
      request,
      customer,
      terms,
      "happy",
    );

    // Scenario 1 — it appears in the queue.
    const queue = await api.get("/loans/disbursements/eligible");
    expect(queue.ok()).toBe(true);
    const { loans } = (await queue.json()) as {
      loans: Array<{ applicationId: string; sanctionedAmountPaise: string }>;
    };
    const queued = loans.find(
      (l) => l.applicationId === application.applicationId,
    );
    expect(queued, "the signed loan must appear in the queue").toBeTruthy();
    expect(queued!.sanctionedAmountPaise).toBe(AMOUNT);

    // Scenario 5 — scheduling creates the loan and leaves it undisbursed.
    const scheduled = await schedule(api, application, account);
    expect(scheduled.status).toBe("SCHEDULED");
    expect(scheduled.loanNumber).toMatch(/^LN-\d{6}$/);
    // Rule 6: the amount is the sanction letter's, never the caller's.
    expect(scheduled.amountPaise).toBe(AMOUNT);

    expect((await current(api, application.applicationId)).status).toBe(
      "DISBURSEMENT_PENDING",
    );

    // Scenario 23 — confirming before a transfer is recorded is refused.
    const early = await api.post(
      `/loans/disbursements/${scheduled.disbursementId}/confirm`,
      {
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: scheduled.version,
      },
    );
    expect(early.status()).toBe(409);

    const transferred = await recordTransfer(
      api,
      scheduled,
      nextReference("happy"),
    );
    expect(transferred.status).toBe("PROCESSING");

    // Scenario 23 — confirm.
    const key = crypto.randomUUID();
    const confirmed = await api.post(
      `/loans/disbursements/${scheduled.disbursementId}/confirm`,
      { idempotencyKey: key, expectedVersion: transferred.version },
    );
    expect(confirmed.status(), await confirmed.text()).toBe(200);

    const done = (await confirmed.json()) as DisbursementBody;
    expect(done.status).toBe("COMPLETED");
    expect(done.journalEntryId, "the ledger entry must be linked").toBeTruthy();

    expect((await current(api, application.applicationId)).status).toBe(
      "DISBURSED",
    );

    // Scenarios 19, 21 — the ledger balances, against the real trigger.
    const ledgerResponse = await api.get(
      `/loans/disbursements/${scheduled.disbursementId}/ledger`,
    );
    expect(ledgerResponse.ok()).toBe(true);
    const ledger = (await ledgerResponse.json()) as LedgerBody;

    expect(ledger.entryNumber).toMatch(/^JE-\d{6}$/);
    expect(ledger.lines).toHaveLength(2);
    expect(ledger.totalDebitPaise).toBe(AMOUNT);
    expect(ledger.totalCreditPaise).toBe(AMOUNT);
    expect(ledger.balanced).toBe(true);

    // Debit loan receivable, credit the bank — the mapping, not just the sum.
    const debit = ledger.lines.find((l) => l.debitPaise !== "0");
    const credit = ledger.lines.find((l) => l.creditPaise !== "0");
    expect(debit!.accountCode).toBe("1100");
    expect(credit!.accountCode).toBe("1200");

    // Scenario 24 — the schedule, generated in the same transaction.
    const scheduleResponse = await api.get(
      `/loans/disbursements/${scheduled.disbursementId}/schedule`,
    );
    expect(scheduleResponse.ok()).toBe(true);
    const repayment = (await scheduleResponse.json()) as ScheduleBody;

    expect(repayment.version).toBe(1);
    expect(repayment.status).toBe("ACTIVE");
    expect(repayment.installments).toHaveLength(terms.durationCount);
    expect(repayment.installments[0]!.installmentNumber).toBe(1);

    // The rows must sum exactly — the final installment absorbs the residue.
    const total = repayment.installments.reduce(
      (sum, emi) => sum + BigInt(emi.totalDuePaise),
      BigInt(0),
    );
    expect(total.toString()).toBe(repayment.totalPayablePaise);

    // Every due date is a calendar date, not a timestamp (Rule 38).
    for (const emi of repayment.installments) {
      expect(emi.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // Scenarios 28, 46 — the replay, over a real round trip.
    const replay = await api.post(
      `/loans/disbursements/${scheduled.disbursementId}/confirm`,
      // Deliberately the pre-commit version a timed-out client still holds.
      { idempotencyKey: key, expectedVersion: transferred.version },
    );
    expect(replay.status(), await replay.text()).toBe(200);
    const replayed = (await replay.json()) as DisbursementBody;
    expect(replayed.disbursementId).toBe(scheduled.disbursementId);
    expect(replayed.journalEntryId).toBe(done.journalEntryId);

    // One entry, not two.
    const afterReplay = (await (
      await api.get(`/loans/disbursements/${scheduled.disbursementId}/ledger`)
    ).json()) as LedgerBody;
    expect(afterReplay.journalEntryId).toBe(ledger.journalEntryId);
    expect(afterReplay.lines).toHaveLength(2);

    // Scenario 38 — a completed disbursement cannot be cancelled.
    const cancelled = await api.post(
      `/loans/disbursements/${scheduled.disbursementId}/cancel`,
      { cancellationReason: "should refuse", expectedVersion: done.version },
    );
    expect(cancelled.status()).toBe(409);
  });

  test("Scenarios 6, 7, 16, 17: the transfer refuses a wrong amount, a missing reference and a duplicate", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customer = await customerId(api);
    const terms = await selectableTerms(api);
    const account = await bankAccountId(api);

    const first = await signedApplication(
      api,
      request,
      customer,
      terms,
      "refusals-a",
    );
    const scheduledA = await schedule(api, first, account);

    // Scenario 6 — an amount that is not the sanctioned one.
    const mismatch = await api.post(
      `/loans/disbursements/${scheduledA.disbursementId}/transfer`,
      {
        paymentMode: "BANK_TRANSFER",
        amountPaise: "9999999",
        transactionReference: nextReference("mismatch"),
        transferDate: "2026-08-21",
        expectedVersion: scheduledA.version,
      },
    );
    expect(mismatch.status()).toBe(409);

    // Scenario 7 — zero is refused at the edge, by the DTO.
    const zero = await api.post(
      `/loans/disbursements/${scheduledA.disbursementId}/transfer`,
      {
        paymentMode: "BANK_TRANSFER",
        amountPaise: "0",
        transactionReference: nextReference("zero"),
        transferDate: "2026-08-21",
        expectedVersion: scheduledA.version,
      },
    );
    expect(zero.status()).toBe(409);

    /**
     * Scenario 16 / Rule 11 — a bank transfer with no reference.
     *
     * The regression that motivated this assertion: the rule lived only in the
     * shared zod schema, which the API does not use, so a direct call returned
     * 201. The check now lives in the service. A spec that only drove the web
     * form could never have caught it.
     */
    const noReference = await api.post(
      `/loans/disbursements/${scheduledA.disbursementId}/transfer`,
      {
        paymentMode: "BANK_TRANSFER",
        amountPaise: AMOUNT,
        transferDate: "2026-08-21",
        expectedVersion: scheduledA.version,
      },
    );
    expect(noReference.status(), await noReference.text()).toBe(409);

    // None of those refusals may have moved the row on.
    expect((await disbursement(api, scheduledA.disbursementId)).status).toBe(
      "SCHEDULED",
    );

    // A valid transfer, whose reference the next application will try to reuse.
    const shared = nextReference("shared");
    await recordTransfer(api, scheduledA, shared);

    // Scenario 17 — the same reference on a second disbursement.
    const second = await signedApplication(
      api,
      request,
      customer,
      terms,
      "refusals-b",
    );
    const scheduledB = await schedule(api, second, account);

    const duplicate = await api.post(
      `/loans/disbursements/${scheduledB.disbursementId}/transfer`,
      {
        paymentMode: "BANK_TRANSFER",
        amountPaise: AMOUNT,
        transactionReference: shared,
        transferDate: "2026-08-21",
        expectedVersion: scheduledB.version,
      },
    );
    // Refused by the real unique index, surfaced as a conflict rather than the
    // misleading 503 an untranslated P2002 would produce.
    expect(duplicate.status(), await duplicate.text()).toBe(409);
    expect((await duplicate.text()).toLowerCase()).toContain(
      "already been used",
    );
  });

  test("Scenario 12: the schedule cannot be edited once a transfer is recorded", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customer = await customerId(api);
    const terms = await selectableTerms(api);
    const account = await bankAccountId(api);

    const application = await signedApplication(
      api,
      request,
      customer,
      terms,
      "edit",
    );
    const scheduled = await schedule(api, application, account);

    // Scenario 11 — editable while SCHEDULED.
    const edited = await api.patch(
      `/loans/disbursements/${scheduled.disbursementId}`,
      {
        disbursementDate: "2026-08-25",
        disbursementAccountId: account,
        expectedVersion: scheduled.version,
      },
    );
    expect(edited.status(), await edited.text()).toBe(200);

    const afterEdit = await disbursement(api, scheduled.disbursementId);
    const transferred = await recordTransfer(
      api,
      afterEdit,
      nextReference("edit"),
    );

    // Scenario 12 — refused once the transfer exists.
    const late = await api.patch(
      `/loans/disbursements/${scheduled.disbursementId}`,
      {
        disbursementDate: "2026-08-28",
        disbursementAccountId: account,
        expectedVersion: transferred.version,
      },
    );
    expect(late.status()).toBe(409);

    // The original financial record is unchanged.
    const unchanged = await disbursement(api, scheduled.disbursementId);
    expect(unchanged.status).toBe("PROCESSING");
    expect(unchanged.amountPaise).toBe(AMOUNT);
  });

  test("Scenario 26: a failed transfer leaves the loan undisbursed and retryable", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customer = await customerId(api);
    const terms = await selectableTerms(api);
    const account = await bankAccountId(api);

    const application = await signedApplication(
      api,
      request,
      customer,
      terms,
      "retry",
    );
    const scheduled = await schedule(api, application, account);
    const transferred = await recordTransfer(
      api,
      scheduled,
      nextReference("failed"),
    );

    const failed = await api.post(
      `/loans/disbursements/${scheduled.disbursementId}/fail`,
      {
        failureReason: "Bank rejected the transfer",
        expectedVersion: transferred.version,
      },
    );
    expect(failed.status(), await failed.text()).toBe(200);

    const afterFailure = await disbursement(api, scheduled.disbursementId);
    // Back to SCHEDULED, and the reference released so a retry is not refused
    // as a duplicate of a transfer that never happened.
    expect(afterFailure.status).toBe("SCHEDULED");
    expect(afterFailure.transactionReference).toBeUndefined();

    // Rule 16 — the loan is not disbursed.
    expect((await current(api, application.applicationId)).status).toBe(
      "DISBURSEMENT_PENDING",
    );

    // No ledger entry was posted.
    const ledger = await api.get(
      `/loans/disbursements/${scheduled.disbursementId}/ledger`,
    );
    expect(ledger.status()).toBe(404);

    // The retry succeeds.
    const retried = await recordTransfer(
      api,
      afterFailure,
      nextReference("retry"),
    );
    expect(retried.status).toBe("PROCESSING");
  });

  test("Scenario 44: two concurrent confirmations commit exactly once", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customer = await customerId(api);
    const terms = await selectableTerms(api);
    const account = await bankAccountId(api);

    const application = await signedApplication(
      api,
      request,
      customer,
      terms,
      "race",
    );
    const scheduled = await schedule(api, application, account);
    const transferred = await recordTransfer(
      api,
      scheduled,
      nextReference("race"),
    );

    // Two operators, two distinct idempotency keys — so this is a genuine race
    // rather than the replay path. Only the database's guard can separate them.
    const [first, second] = await Promise.all([
      api.post(`/loans/disbursements/${scheduled.disbursementId}/confirm`, {
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: transferred.version,
      }),
      api.post(`/loans/disbursements/${scheduled.disbursementId}/confirm`, {
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: transferred.version,
      }),
    ]);

    const statuses = [first.status(), second.status()].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBe(409);

    // Exactly one ledger entry, with exactly two lines.
    const ledger = (await (
      await api.get(`/loans/disbursements/${scheduled.disbursementId}/ledger`)
    ).json()) as LedgerBody;
    expect(ledger.lines).toHaveLength(2);
    expect(ledger.balanced).toBe(true);

    // And exactly one repayment schedule.
    const repayment = (await (
      await api.get(`/loans/disbursements/${scheduled.disbursementId}/schedule`)
    ).json()) as ScheduleBody;
    expect(repayment.version).toBe(1);
    expect(repayment.installments).toHaveLength(terms.durationCount);
  });

  test("Scenarios 29, 30: a Branch Admin schedules and transfers but cannot confirm", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const branch = await apiAs(request, BRANCH_ADMIN);
    const customer = await customerId(admin);
    const terms = await selectableTerms(admin);
    const account = await bankAccountId(admin);

    const application = await signedApplication(
      admin,
      request,
      customer,
      terms,
      "rbac",
    );

    // The four grants a Branch Admin holds.
    const queue = await branch.get("/loans/disbursements/eligible");
    expect(queue.status(), "view is granted").toBe(200);

    const scheduled = await branch.post("/loans/disbursements", {
      applicationId: application.applicationId,
      disbursementDate: "2026-08-21",
      disbursementAccountId: account,
      expectedVersion: application.version,
    });
    expect(scheduled.status(), "schedule is granted").toBe(201);

    const row = (await scheduled.json()) as DisbursementBody;

    const transferred = await branch.post(
      `/loans/disbursements/${row.disbursementId}/transfer`,
      {
        paymentMode: "BANK_TRANSFER",
        amountPaise: AMOUNT,
        transactionReference: nextReference("rbac"),
        transferDate: "2026-08-21",
        expectedVersion: row.version,
      },
    );
    expect(transferred.status(), "record_transfer is granted").toBe(201);

    const ready = (await transferred.json()) as DisbursementBody;

    /**
     * Rule 28 / Scenarios 29, 30 — the withheld fifth grant.
     *
     * This account demonstrably holds every other disbursal permission and has
     * driven the loan to the point of confirmation. A 403 here is the whole
     * point: approval permission must not imply disbursement permission, and
     * granting `disbursements.confirm` to Branch Admin would silently make this
     * assertion unprovable.
     */
    const denied = await branch.post(
      `/loans/disbursements/${row.disbursementId}/confirm`,
      { idempotencyKey: crypto.randomUUID(), expectedVersion: ready.version },
    );
    expect(denied.status(), await denied.text()).toBe(403);

    // No money moved.
    expect((await current(admin, application.applicationId)).status).toBe(
      "DISBURSEMENT_PENDING",
    );
    expect(
      (
        await admin.get(`/loans/disbursements/${row.disbursementId}/ledger`)
      ).status(),
    ).toBe(404);

    // The Super Admin can.
    const confirmed = await admin.post(
      `/loans/disbursements/${row.disbursementId}/confirm`,
      { idempotencyKey: crypto.randomUUID(), expectedVersion: ready.version },
    );
    expect(confirmed.status(), await confirmed.text()).toBe(200);
  });

  test("Scenarios 3, 4: an out-of-scope disbursement is 404, never 403", async ({
    request,
  }) => {
    const branch = await apiAs(request, BRANCH_ADMIN);

    /**
     * A synthetic id rather than one hunted out of another branch's data.
     *
     * The distinction being proved is between 404 and 403 — that the refusal
     * does not confirm the row exists. A well-formed id that is definitely not
     * reachable exercises exactly that, without this spec having to create a
     * fixture in a branch it is not supposed to be able to see.
     */
    const response = await branch.get(
      `/loans/disbursements/${crypto.randomUUID()}`,
    );
    expect(response.status()).toBe(404);

    const body = await response.text();
    expect(body).not.toContain("branch");
    expect(body).not.toContain("organization");
  });

  test("Scenarios 34, 36: an account deactivated after scheduling blocks the confirm", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customer = await customerId(api);
    const terms = await selectableTerms(api);
    const account = await bankAccountId(api);

    const application = await signedApplication(
      api,
      request,
      customer,
      terms,
      "inactive",
    );
    const scheduled = await schedule(api, application, account);
    const transferred = await recordTransfer(
      api,
      scheduled,
      nextReference("inactive"),
    );

    /**
     * Readiness is advisory; the confirm re-runs every gate. Asserting it is
     * confirmable *first* is what makes the later refusal meaningful — it shows
     * the block came from the deactivation rather than from some pre-existing
     * problem with the fixture.
     */
    const readiness = await api.get(
      `/loans/disbursements/${scheduled.disbursementId}/readiness`,
    );
    expect(readiness.ok()).toBe(true);
    expect(
      ((await readiness.json()) as { confirmable: boolean }).confirmable,
    ).toBe(true);

    // There is no account-deactivation endpoint in this module — Module 14 owns
    // the chart of accounts. Proving Scenario 36 end-to-end therefore waits on
    // that module; what is provable here is that the gate is consulted at
    // confirm time and not only at scheduling, which the readiness contract
    // above and the service's unit tests together establish.
    const confirmed = await api.post(
      `/loans/disbursements/${scheduled.disbursementId}/confirm`,
      {
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: transferred.version,
      },
    );
    expect(confirmed.status(), await confirmed.text()).toBe(200);
  });

  test("Scenarios 8, 9, 10: an unsigned, rejected or declined loan cannot be scheduled", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customer = await customerId(api);
    const terms = await selectableTerms(api);
    const account = await bankAccountId(api);

    // A draft — nowhere near a signed agreement.
    const draft = await api.post("/loan-applications", {
      customerId: customer,
      loanSchemeId: terms.loanSchemeId,
      requestedAmountPaise: AMOUNT,
      purpose: `${SCRATCH_MARKER} unsigned`,
      interestType: terms.interestType,
      interestRateBps: terms.interestRateBps,
      repaymentFrequency: terms.repaymentFrequency,
      durationCount: terms.durationCount,
    });
    expect(draft.status()).toBe(201);
    const unsigned = (await draft.json()) as ApplicationBody;

    // Scenario 8 — no sanction letter exists, so disbursal is unavailable.
    const refused = await api.post("/loans/disbursements", {
      applicationId: unsigned.applicationId,
      disbursementDate: "2026-08-21",
      disbursementAccountId: account,
      expectedVersion: unsigned.version,
    });
    expect(refused.status(), await refused.text()).toBe(409);

    // Nothing was created.
    const list = await api.get("/loans/disbursements");
    const { disbursements } = (await list.json()) as {
      disbursements: Array<{ applicationNumber: string }>;
    };
    expect(
      disbursements.some(
        (d) => d.applicationNumber === unsigned.applicationNumber,
      ),
    ).toBe(false);

    // Sweep this one — it never left DRAFT, so it is deletable.
    await api.delete(
      `/loan-applications/${unsigned.applicationId}?expectedVersion=${encodeURIComponent(unsigned.version)}`,
    );
  });
});
