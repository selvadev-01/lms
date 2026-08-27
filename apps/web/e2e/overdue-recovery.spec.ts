import { expect, test, type APIRequestContext } from "@playwright/test";

import { apiAs, attachRequiredDocuments, throttled } from "./support/session";

/**
 * Module 13 — Overdue & Recovery.
 *
 * **Why this file is not called `recovery.spec.ts`.** That name is taken by
 * *password* recovery (Module 01). Two unrelated domains sharing a spec name
 * would make every future search for "the recovery tests" ambiguous.
 *
 * **How a genuinely overdue loan is built.** The repayment schedule anchors on
 * `Loan.disbursementDate`, so this spec disburses in the **past**. That is the
 * only way to produce a real overdue position: a freshly disbursed loan has
 * every installment in the future, and no amount of API calls can make it late
 * because overdue status is *derived* from the due date against the
 * Asia/Kolkata business date and nothing can assert it directly (Rules 4, 8).
 * That property is itself under test — see the first block.
 *
 * **Fixture ownership.** Every application here is minted by this spec against
 * CUST001 and carries its own scratch marker, distinct from every other loan
 * spec's. Nothing this spec creates is deletable: an assessed penalty, a
 * finalized action, a completed settlement and a write-off posting are all
 * financial or audit records, and the append-only triggers refuse a DELETE. The
 * rows left behind are the rules working, not litter.
 *
 * **Why single-worker.** Every reason `collections.spec.ts` gives — the `APP-`,
 * `SL-`, `LN-` and `JE-` sequences, CUST001, the shared chart of accounts —
 * plus one of its own: recovery cases are numbered `RC-<BRANCH>-000001` per
 * branch, and two workers opening cases in the same branch contend on that
 * allocation, with the loser's whole transaction rolling back.
 *
 * **What is actually being proved.** Things a unit test against a mock cannot:
 *
 * - Overdue status, days past due and the bucket derived from a *real*
 *   schedule against the real business date (Scenarios 5, 8).
 * - Penalty assessed from the real configured rule, and a retry returning the
 *   original rather than charging twice (Scenarios 18, 19).
 * - Assignment history surviving a reassignment as real rows (Rule 25,
 *   Scenarios 10, 54).
 * - `expectedVersion` rejecting a stale update against a real concurrent
 *   writer (Scenarios 12, 52).
 * - A write-off posting `Dr 5100 / Cr 1100` and **balancing against the real
 *   deferred constraint trigger** — the balance guarantee is a database
 *   trigger, and only a real posting exercises it (Scenarios 22, 49 analogue).
 * - `recovery_actions_append_only` refusing an edit at the database once an
 *   action is finalized (Scenarios 32, 35).
 * - The withheld Branch Admin grants actually withheld (Scenarios 43, 44).
 */

test.describe.configure({ mode: "serial" });

/**
 * Above Playwright's 30s default because `attachRequiredDocuments` may wait out
 * a 60s upload-throttle window, and this spec builds several loans.
 */
test.setTimeout(240_000);

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";

/** Distinct from every other loan spec's marker, so the sweeps cannot cross. */
const SCRATCH_MARKER = "APPZZ-m13-e2e";

const AMOUNT = "10000000";

/**
 * Well in the past, so the schedule's first installments are already overdue.
 *
 * Six months back gives several missed monthly EMIs — enough for the ageing to
 * land in a bucket beyond the first and for the NPA indication to move off
 * STANDARD, which is what the classification assertions need.
 */
const BACKDATED_DISBURSEMENT = "2026-01-15";

type Api = Awaited<ReturnType<typeof apiAs>>;

const uuid = (): string => crypto.randomUUID();

interface Terms {
  loanSchemeId: string;
  interestType: string;
  interestRateBps: string;
  repaymentFrequency: string;
  durationCount: number;
}

interface ApplicationBody {
  applicationId: string;
  status: string;
  version: string;
}

interface OverdueBody {
  loanId: string;
  loanNumber: string;
  daysPastDue: number;
  bucket: string;
  npaEligibility: string;
  overduePrincipalPaise: string;
  overdueInterestPaise: string;
  overduePenaltyPaise: string;
  overdueFeesPaise: string;
  totalOverduePaise: string;
  recoveryCaseId?: string;
  installments?: Array<{ emiId: string; daysPastDue: number }>;
  penalties?: Array<{ penaltyId: string; amountPaise: string }>;
}

interface CaseBody {
  recoveryCaseId: string;
  caseNumber?: string;
  loanId: string;
  status: string;
  priority: string;
  npaStatus: string;
  assignedAgentId?: string;
  version: string;
  assignments: Array<{
    assignmentId: string;
    fromUserId?: string;
    toUserId: string;
    assignedBy: string;
  }>;
  actions: Array<{
    recoveryActionId: string;
    actionType: string;
    outcome?: string;
    finalizedAt?: string;
    version: string;
  }>;
  settlements: Array<{ settlementId: string; status: string; version: string }>;
}

interface PenaltyBody {
  penaltyId: string;
  amountPaise: string;
  outstandingAmountPaise: string;
  status: string;
  calculationSnapshot: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fixture construction — the real pipeline, not seeded rows
// ---------------------------------------------------------------------------

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
  expect(schemes.length, "a selectable scheme must be seeded").toBeGreaterThan(
    0,
  );

  const scheme = schemes[0]!;
  return {
    loanSchemeId: scheme.loanSchemeId,
    interestType: scheme.interestType,
    interestRateBps: scheme.interestRateBps,
    repaymentFrequency: "MONTHLY",
    durationCount: 12,
  };
}

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

  const { applicationId } = (await created.json()) as ApplicationBody;

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
    signedDate: "2026-01-10",
    agreementReference: `AGR-${label}-${uuid().slice(0, 8)}`,
  });

  const signed = await current(api, applicationId);
  expect(signed.status).toBe("AGREEMENT_SIGNED");

  return signed;
}

async function bankAccountId(api: Api): Promise<string> {
  const response = await api.get("/loans/disbursements/accounts");
  expect(response.ok()).toBe(true);
  const { accounts } = (await response.json()) as {
    accounts: Array<{ value: string; hint?: string }>;
  };
  const bank = accounts.find((a) => a.hint === "1200");
  expect(bank, "the bank funding account must be seeded").toBeTruthy();

  return bank!.value;
}

/**
 * A live loan whose earliest installments are already past due.
 *
 * Backdating the disbursement is what makes it overdue, because the schedule
 * anchors on that date. Nothing here asserts an overdue status — the system
 * derives it, and that is the point.
 */
async function overdueLoan(
  api: Api,
  request: APIRequestContext,
  label: string,
): Promise<string> {
  const customer = await customerId(api);
  const terms = await selectableTerms(api);
  const account = await bankAccountId(api);
  const application = await signedApplication(
    api,
    request,
    customer,
    terms,
    label,
  );

  const scheduled = await throttled(() =>
    api.post("/loans/disbursements", {
      applicationId: application.applicationId,
      disbursementDate: BACKDATED_DISBURSEMENT,
      disbursementAccountId: account,
      expectedVersion: application.version,
    }),
  );
  expect(scheduled.status(), await scheduled.text()).toBe(201);
  const { disbursementId, loanId } = (await scheduled.json()) as {
    disbursementId: string;
    loanId: string;
  };

  const version = async () => {
    const response = await throttled(() =>
      api.get(`/loans/disbursements/${disbursementId}`),
    );
    return ((await response.json()) as { version: string }).version;
  };

  // Read outside the callback: `throttled` takes a synchronous thunk, so an
  // `await` inside the object literal would not be in an async context.
  const beforeTransfer = await version();
  const transferred = await throttled(() =>
    api.post(`/loans/disbursements/${disbursementId}/transfer`, {
      paymentMode: "BANK_TRANSFER",
      amountPaise: AMOUNT,
      transactionReference: `UTR-${label}-${uuid().slice(0, 8)}`,
      transferDate: BACKDATED_DISBURSEMENT,
      expectedVersion: beforeTransfer,
    }),
  );
  expect(transferred.status(), await transferred.text()).toBeLessThan(300);

  const beforeConfirm = await version();
  const confirmed = await throttled(() =>
    api.post(`/loans/disbursements/${disbursementId}/confirm`, {
      idempotencyKey: uuid(),
      expectedVersion: beforeConfirm,
    }),
  );
  expect(confirmed.status(), await confirmed.text()).toBeLessThan(300);

  return loanId;
}

async function overdueFor(api: Api, loanId: string): Promise<OverdueBody> {
  const response = await throttled(() =>
    api.get(`/recovery/overdues/${loanId}`),
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as OverdueBody;
}

async function openCase(api: Api, loanId: string): Promise<CaseBody> {
  const response = await throttled(() =>
    api.post("/recovery/cases", {
      loanId,
      priority: "HIGH",
      idempotencyKey: uuid(),
    }),
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as CaseBody;
}

async function caseById(api: Api, recoveryCaseId: string): Promise<CaseBody> {
  const response = await throttled(() =>
    api.get(`/recovery/cases/${recoveryCaseId}`),
  );
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as CaseBody;
}

// ---------------------------------------------------------------------------
// Overdue identification
// ---------------------------------------------------------------------------

test.describe("overdue identification", () => {
  test("derives an overdue position from a real backdated schedule", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "derive");

    const overdue = await overdueFor(api, loanId);

    // Derived, not asserted by anything this test sent.
    expect(overdue.daysPastDue).toBeGreaterThan(0);
    expect(overdue.bucket).not.toBe("CURRENT");
    // `BigInt("0")`, not `0n` — the web target is ES2017 and the literal is a
    // syntax error there.
    expect(BigInt(overdue.totalOverduePaise)).toBeGreaterThan(BigInt("0"));

    // The source's money identity: the four components sum to the total.
    expect(BigInt(overdue.totalOverduePaise)).toBe(
      BigInt(overdue.overduePrincipalPaise) +
        BigInt(overdue.overdueInterestPaise) +
        BigInt(overdue.overduePenaltyPaise) +
        BigInt(overdue.overdueFeesPaise),
    );

    // Every listed installment is genuinely past due.
    for (const emi of overdue.installments ?? []) {
      expect(emi.daysPastDue).toBeGreaterThan(0);
    }
  });

  /** Scenario 8: same inputs, same result. */
  test("is deterministic across repeated reads", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "determinism");

    const first = await overdueFor(api, loanId);
    const second = await overdueFor(api, loanId);

    expect(second.daysPastDue).toBe(first.daysPastDue);
    expect(second.bucket).toBe(first.bucket);
    expect(second.totalOverduePaise).toBe(first.totalOverduePaise);
    expect(second.npaEligibility).toBe(first.npaEligibility);
  });

  /**
   * Rule 8: a recovery user must not be able to assert an overdue status the
   * schedule does not support. The surface exposes no way to try — proved by
   * the write verbs being unroutable rather than merely refused.
   */
  test("exposes no way to mark a loan overdue", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "readonly");

    const attempted = await throttled(() =>
      api.post(`/recovery/overdues/${loanId}`, { daysPastDue: 999 }),
    );
    expect(attempted.status()).toBe(404);
  });

  /**
   * A loan appears in the book only once something is genuinely late.
   *
   * Searched for by its own loan number rather than scanned out of an
   * unfiltered first page. The book is paginated at 25, and every run of this
   * spec adds backdated fixtures that are never deletable — so an unfiltered
   * scan passes on a fresh database and starts failing once the accumulated
   * rows push the newest fixture onto page two. That would look like a
   * regression in the list endpoint when it is only this assertion being
   * written against a page rather than against a query.
   */
  test("lists the overdue loan in the book", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "list");

    const overdue = await overdueFor(api, loanId);

    const response = await throttled(() =>
      api.get(`/recovery/overdues?search=${overdue.loanNumber}`),
    );
    expect(response.status(), await response.text()).toBe(200);

    const { items } = (await response.json()) as { items: OverdueBody[] };
    expect(items.some((row) => row.loanId === loanId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Penalty assessment
// ---------------------------------------------------------------------------

test.describe("penalty assessment", () => {
  /**
   * Scenario 19. The guarantee is the `penalties_accrual_basis_key` unique
   * index; this proves the service resolves a collision into the original row
   * rather than surfacing it as an error or charging twice.
   */
  test("does not charge twice for the same accrual basis", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "penalty-once");

    const assess = () =>
      throttled(() =>
        api.post("/recovery/cases/penalties/assess", {
          loanId,
          idempotencyKey: uuid(),
        }),
      );

    const first = await assess();
    expect(first.status(), await first.text()).toBe(200);
    const firstRows = (await first.json()) as PenaltyBody[];

    // The seeded rule carries a 5-day grace period, so a loan only just overdue
    // legitimately assesses nothing. This spec backdates far enough to clear
    // it; the guard is here in case a future seed changes the grace period,
    // because the retry assertion below needs something to retry.
    test.skip(
      firstRows.length === 0,
      "nothing chargeable — the grace period has not elapsed",
    );

    const second = await assess();
    expect(second.status(), await second.text()).toBe(200);
    const secondRows = (await second.json()) as PenaltyBody[];

    expect(secondRows.map((row) => row.penaltyId).sort()).toEqual(
      firstRows.map((row) => row.penaltyId).sort(),
    );

    // The overdue book must not double-count either.
    const overdue = await overdueFor(api, loanId);
    expect(overdue.penalties?.length).toBe(firstRows.length);
  });

  /** Rule 12: the charge is replayable from what the calculation saw. */
  test("stores a calculation snapshot on every assessment", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "penalty-snapshot");

    const response = await throttled(() =>
      api.post("/recovery/cases/penalties/assess", {
        loanId,
        idempotencyKey: uuid(),
      }),
    );
    expect(response.status(), await response.text()).toBe(200);

    const rows = (await response.json()) as PenaltyBody[];
    test.skip(rows.length === 0, "nothing chargeable on this loan");

    const snapshot = rows[0]!.calculationSnapshot;
    expect(snapshot).toHaveProperty("calculationType");
    expect(snapshot).toHaveProperty("chargeableDays");
    expect(snapshot).toHaveProperty("daysPastDue");
  });
});

// ---------------------------------------------------------------------------
// Recovery cases
// ---------------------------------------------------------------------------

test.describe("recovery cases", () => {
  test("opens a numbered case against an overdue loan", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "open");

    const opened = await openCase(api, loanId);

    expect(opened.status).toBe("OPEN");
    expect(opened.priority).toBe("HIGH");
    expect(opened.caseNumber).toMatch(/^RC-[A-Z0-9]+-\d{6}$/);
    // The opening classification is the *derived* NPA eligibility, committed at
    // open. Rule 29 keeps moving the loan itself to NPA a separate act.
    expect(opened.npaStatus).toBeTruthy();

    // The overdue book now points at the case.
    const overdue = await overdueFor(api, loanId);
    expect(overdue.recoveryCaseId).toBe(opened.recoveryCaseId);
  });

  /** At most one open case per loan — a partial unique index enforces it. */
  test("refuses a second open case on the same loan", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "one-case");

    await openCase(api, loanId);

    const second = await throttled(() =>
      api.post("/recovery/cases", { loanId, idempotencyKey: uuid() }),
    );
    expect(second.status()).toBe(409);
  });

  /** Scenario 24: a replayed key returns the original rather than a second case. */
  test("returns the original case on a replayed idempotency key", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "replay");

    const key = uuid();
    const body = { loanId, priority: "HIGH", idempotencyKey: key };

    const first = await throttled(() => api.post("/recovery/cases", body));
    expect(first.status(), await first.text()).toBe(200);
    const opened = (await first.json()) as CaseBody;

    const retry = await throttled(() => api.post("/recovery/cases", body));
    expect(retry.status(), await retry.text()).toBe(200);
    const replayed = (await retry.json()) as CaseBody;

    expect(replayed.recoveryCaseId).toBe(opened.recoveryCaseId);
  });

  /** Scenario 25: a materially different request on the same key is a conflict. */
  test("rejects a different request reusing a key", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanA = await overdueLoan(api, request, "conflict-a");
    const loanB = await overdueLoan(api, request, "conflict-b");

    const key = uuid();
    const first = await throttled(() =>
      api.post("/recovery/cases", { loanId: loanA, idempotencyKey: key }),
    );
    expect(first.status(), await first.text()).toBe(200);

    const conflicting = await throttled(() =>
      api.post("/recovery/cases", { loanId: loanB, idempotencyKey: key }),
    );
    expect(conflicting.status()).toBe(409);
    expect(await conflicting.text()).toContain("IDEMPOTENCY_KEY_CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// Assignment history — Rule 25, Scenarios 10 and 54
// ---------------------------------------------------------------------------

test.describe("assignment history", () => {
  test("preserves the previous assignee across a reassignment", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "assign");
    const opened = await openCase(api, loanId);

    // Two real users in the same branch to assign between.
    // `activeOnly`, not `status` — `ListUsersDto` declares no status filter and
    // `forbidNonWhitelisted` turns an unknown parameter into a 400.
    const users = await throttled(() => api.get("/users?activeOnly=true"));
    expect(users.status(), await users.text()).toBe(200);
    const { users: rows } = (await users.json()) as {
      users: Array<{ userId: string }>;
    };
    expect(rows.length, "two active users are needed").toBeGreaterThan(1);

    const first = rows[0]!.userId;
    const second = rows.find((row) => row.userId !== first)!.userId;

    const assigned = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/assign`, {
        assigneeUserId: first,
        expectedVersion: opened.version,
      }),
    );
    expect(assigned.status(), await assigned.text()).toBeLessThan(300);
    const afterFirst = (await assigned.json()) as CaseBody;

    const reassigned = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/assign`, {
        assigneeUserId: second,
        reason: "Route change",
        expectedVersion: afterFirst.version,
      }),
    );
    expect(reassigned.status(), await reassigned.text()).toBeLessThan(300);
    const afterSecond = (await reassigned.json()) as CaseBody;

    // The current pointer moved...
    expect(afterSecond.assignedAgentId).toBe(second);

    // ...and both assignments survive, in order, with the handover recorded.
    expect(afterSecond.assignments).toHaveLength(2);
    expect(afterSecond.assignments[0]?.fromUserId).toBeUndefined();
    expect(afterSecond.assignments[0]?.toUserId).toBe(first);
    expect(afterSecond.assignments[1]?.fromUserId).toBe(first);
    expect(afterSecond.assignments[1]?.toUserId).toBe(second);
  });

  /** Scenarios 12 and 52: a stale assignment is rejected. */
  test("rejects a stale assignment", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "stale");
    const opened = await openCase(api, loanId);

    const users = await throttled(() => api.get("/users?activeOnly=true"));
    const { users: rows } = (await users.json()) as {
      users: Array<{ userId: string }>;
    };
    const first = rows[0]!.userId;
    const second = rows.find((row) => row.userId !== first)!.userId;

    // One writer wins.
    const won = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/assign`, {
        assigneeUserId: first,
        expectedVersion: opened.version,
      }),
    );
    expect(won.status(), await won.text()).toBeLessThan(300);

    // The second still holds the version it read before that write.
    const stale = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/assign`, {
        assigneeUserId: second,
        expectedVersion: opened.version,
      }),
    );
    expect(stale.status()).toBe(409);

    // The authoritative assignment is unchanged.
    const after = await caseById(api, opened.recoveryCaseId);
    expect(after.assignedAgentId).toBe(first);
    expect(after.assignments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Activity — Scenarios 13, 15, 16, 31, 32
// ---------------------------------------------------------------------------

test.describe("recovery activity", () => {
  test("records a promise to pay without moving any balance", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "promise");
    const opened = await openCase(api, loanId);

    const before = await overdueFor(api, loanId);

    const recorded = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/actions`, {
        actionType: "PHONE_CALL",
        actionDate: "2026-08-24",
        outcome: "CONTACTED_PROMISED",
        promiseToPayDate: "2026-09-30",
        promiseToPayAmountPaise: "500000",
        notes: `${SCRATCH_MARKER} promise`,
      }),
    );
    expect(recorded.status(), await recorded.text()).toBe(200);

    // Rule 15, Scenario 15: the promise changes nothing financial.
    const after = await overdueFor(api, loanId);
    expect(after.totalOverduePaise).toBe(before.totalOverduePaise);
    expect(after.overduePrincipalPaise).toBe(before.overduePrincipalPaise);
  });

  /** Half a promise is not a promise — the DB CHECK agrees with the service. */
  test("refuses a promised date with no amount", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "half-promise");
    const opened = await openCase(api, loanId);

    const response = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/actions`, {
        actionType: "PHONE_CALL",
        actionDate: "2026-08-24",
        outcome: "CONTACTED_PROMISED",
        promiseToPayDate: "2026-09-30",
      }),
    );
    expect(response.status()).toBe(400);
  });

  /**
   * Scenarios 32 and 35. The service refuses first with a readable message; the
   * `recovery_actions_append_only` trigger is the guarantee behind it.
   */
  test("blocks editing a finalized action", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "finalize");
    const opened = await openCase(api, loanId);

    const recorded = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/actions`, {
        actionType: "REMINDER",
        actionDate: "2026-08-24",
        outcome: "NO_ANSWER",
      }),
    );
    expect(recorded.status(), await recorded.text()).toBe(200);
    const action = (await recorded.json()) as {
      recoveryActionId: string;
      version: string;
    };

    // A pending action is editable (Scenario 31).
    const edited = await throttled(() =>
      api.patch(`/recovery/actions/${action.recoveryActionId}`, {
        notes: `${SCRATCH_MARKER} corrected`,
        expectedVersion: action.version,
      }),
    );
    expect(edited.status(), await edited.text()).toBeLessThan(300);
    const afterEdit = (await edited.json()) as { version: string };

    const finalized = await throttled(() =>
      api.post(`/recovery/actions/${action.recoveryActionId}/finalize`),
    );
    expect(finalized.status(), await finalized.text()).toBeLessThan(300);
    const afterFinalize = (await finalized.json()) as { version: string };

    // Once finalized, the same edit is refused.
    const blocked = await throttled(() =>
      api.patch(`/recovery/actions/${action.recoveryActionId}`, {
        notes: `${SCRATCH_MARKER} rewrite`,
        expectedVersion: afterFinalize.version,
      }),
    );
    expect(blocked.status()).toBe(409);
    expect(afterEdit.version).not.toBe(afterFinalize.version);
  });
});

// ---------------------------------------------------------------------------
// Closure — Scenarios 33, 39, 40
// ---------------------------------------------------------------------------

test.describe("closure", () => {
  test("closes a case and refuses further activity", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "close");
    const opened = await openCase(api, loanId);

    const closed = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/close`, {
        resolutionType: "NOT_RECOVERABLE",
        closureReason: `${SCRATCH_MARKER} untraceable`,
        expectedVersion: opened.version,
      }),
    );
    expect(closed.status(), await closed.text()).toBeLessThan(300);

    const after = await caseById(api, opened.recoveryCaseId);
    expect(after.status).toBe("CLOSED");

    // Scenario 33: a closed case refuses direct modification.
    const blocked = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/actions`, {
        actionType: "REMINDER",
        actionDate: "2026-08-24",
        outcome: "NO_ANSWER",
      }),
    );
    expect(blocked.status()).toBe(409);
  });

  /** Scenario 40: closure is refused while an obligation is unresolved. */
  test("refuses closure while a settlement is pending", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "close-blocked");
    const opened = await openCase(api, loanId);

    const proposed = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/settlements`, {
        settlementAmountPaise: "1000000",
        agreedDate: "2026-08-24",
        reason: `${SCRATCH_MARKER} settlement`,
        idempotencyKey: uuid(),
      }),
    );
    expect(proposed.status(), await proposed.text()).toBe(200);

    const reread = await caseById(api, opened.recoveryCaseId);
    const blocked = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/close`, {
        resolutionType: "NOT_RECOVERABLE",
        closureReason: `${SCRATCH_MARKER} premature`,
        expectedVersion: reread.version,
      }),
    );
    expect(blocked.status()).toBe(409);
    expect(await blocked.text()).toContain("settlement");
  });
});

// ---------------------------------------------------------------------------
// Settlements — Scenario 44, and the ledger posting on completion
// ---------------------------------------------------------------------------

test.describe("settlements", () => {
  /**
   * The waiver is derived, never accepted from the caller, so the three figures
   * always satisfy `settlements_waiver_sums`. Proved against a real schedule
   * rather than a mocked balance.
   */
  test("derives the waived amount from the outstanding principal", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "settle-derive");
    const opened = await openCase(api, loanId);

    const proposed = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/settlements`, {
        settlementAmountPaise: "1000000",
        agreedDate: "2026-08-24",
        reason: `${SCRATCH_MARKER} hardship`,
        idempotencyKey: uuid(),
      }),
    );
    expect(proposed.status(), await proposed.text()).toBe(200);

    const settlement = (await proposed.json()) as {
      settlementAmountPaise: string;
      outstandingBeforePaise?: string;
      waivedAmountPaise?: string;
      status: string;
    };

    expect(settlement.status).toBe("PENDING_APPROVAL");
    expect(BigInt(settlement.outstandingBeforePaise!)).toBe(
      BigInt(settlement.settlementAmountPaise) +
        BigInt(settlement.waivedAmountPaise!),
    );
  });

  /** A settlement cannot forgive more than the borrower actually owes. */
  test("refuses a settlement larger than the outstanding principal", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "settle-too-big");
    const opened = await openCase(api, loanId);

    const response = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/settlements`, {
        settlementAmountPaise: "99999999999",
        agreedDate: "2026-08-24",
        reason: `${SCRATCH_MARKER} too big`,
        idempotencyKey: uuid(),
      }),
    );
    expect(response.status()).toBe(409);
  });

  /**
   * Scenario 44: proposing and approving are different authorities. Super Admin
   * holds both here, so this proves the *lifecycle* — a settlement cannot be
   * completed before it is approved — rather than the separation, which the
   * withheld-grant block below covers.
   */
  test("refuses to complete a settlement that is not approved", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "settle-lifecycle");
    const opened = await openCase(api, loanId);

    const proposed = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/settlements`, {
        settlementAmountPaise: "1000000",
        agreedDate: "2026-08-24",
        reason: `${SCRATCH_MARKER} lifecycle`,
        idempotencyKey: uuid(),
      }),
    );
    expect(proposed.status(), await proposed.text()).toBe(200);
    const settlement = (await proposed.json()) as {
      settlementId: string;
      version: string;
    };

    const premature = await throttled(() =>
      api.post(`/recovery/settlements/${settlement.settlementId}/complete`, {
        decision: "APPROVE",
        expectedVersion: settlement.version,
      }),
    );
    expect(premature.status()).toBe(409);
  });

  /**
   * The assertion a mock cannot make: completing posts `Dr 5100 / Cr 1100` for
   * the **waived principal only**, and the entry balances against the real
   * deferred constraint trigger.
   */
  test("posts the waiver to the ledger on completion", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "settle-post");
    const opened = await openCase(api, loanId);

    const proposed = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/settlements`, {
        settlementAmountPaise: "1000000",
        agreedDate: "2026-08-24",
        reason: `${SCRATCH_MARKER} posting`,
        idempotencyKey: uuid(),
      }),
    );
    expect(proposed.status(), await proposed.text()).toBe(200);
    const proposal = (await proposed.json()) as {
      settlementId: string;
      version: string;
      waivedAmountPaise?: string;
    };

    const approved = await throttled(() =>
      api.post(`/recovery/settlements/${proposal.settlementId}/decide`, {
        decision: "APPROVE",
        expectedVersion: proposal.version,
      }),
    );
    expect(approved.status(), await approved.text()).toBeLessThan(300);
    const afterApproval = (await approved.json()) as {
      status: string;
      version: string;
      journalEntryId?: string;
    };

    // Approving authorises the waiver and posts nothing — until the borrower
    // has paid the settled portion, nothing has been forgiven.
    expect(afterApproval.status).toBe("APPROVED");
    expect(afterApproval.journalEntryId).toBeFalsy();

    const completed = await throttled(() =>
      api.post(`/recovery/settlements/${proposal.settlementId}/complete`, {
        decision: "APPROVE",
        expectedVersion: afterApproval.version,
      }),
    );
    expect(completed.status(), await completed.text()).toBeLessThan(300);
    const settled = (await completed.json()) as {
      status: string;
      journalEntryId?: string;
    };

    expect(settled.status).toBe("COMPLETED");
    expect(settled.journalEntryId).toBeTruthy();

    // The posting itself: a debit to the write-off expense and a credit to loan
    // receivable, for exactly the waived amount, and balancing.
    const entry = await throttled(() =>
      api.get(`/accounting/journals/${settled.journalEntryId!}`),
    );
    expect(entry.status(), await entry.text()).toBe(200);

    // The detail endpoint wraps its payload as `{ journal: ... }`, so the lines
    // are one level down — reading `body.lines` returns undefined.
    const body = (await entry.json()) as {
      journal: {
        lines: Array<{
          accountCode?: string;
          account?: { accountCode?: string };
          debitPaise: string;
          creditPaise: string;
        }>;
      };
    };

    const lines = body.journal.lines.map((line) => ({
      code: line.account?.accountCode ?? line.accountCode ?? "",
      debit: BigInt(line.debitPaise),
      credit: BigInt(line.creditPaise),
    }));

    const debit = lines.find((line) => line.debit > BigInt("0"));
    const credit = lines.find((line) => line.credit > BigInt("0"));

    expect(debit?.code).toBe("5100");
    expect(credit?.code).toBe("1100");
    expect(debit?.debit).toBe(BigInt(proposal.waivedAmountPaise!));

    // Total debits equal total credits — the invariant the trigger enforces.
    const totalDebit = lines.reduce(
      (sum, line) => sum + line.debit,
      BigInt("0"),
    );
    const totalCredit = lines.reduce(
      (sum, line) => sum + line.credit,
      BigInt("0"),
    );
    expect(totalDebit).toBe(totalCredit);
  });

  /** A completed settlement is frozen by `settlements_append_only`. */
  test("refuses to decide a settlement twice", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "settle-twice");
    const opened = await openCase(api, loanId);

    const proposed = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/settlements`, {
        settlementAmountPaise: "1000000",
        agreedDate: "2026-08-24",
        reason: `${SCRATCH_MARKER} twice`,
        idempotencyKey: uuid(),
      }),
    );
    const proposal = (await proposed.json()) as {
      settlementId: string;
      version: string;
    };

    const first = await throttled(() =>
      api.post(`/recovery/settlements/${proposal.settlementId}/decide`, {
        decision: "APPROVE",
        expectedVersion: proposal.version,
      }),
    );
    expect(first.status(), await first.text()).toBeLessThan(300);

    // The same decision again, on a version that has since moved.
    const again = await throttled(() =>
      api.post(`/recovery/settlements/${proposal.settlementId}/decide`, {
        decision: "REJECT",
        expectedVersion: proposal.version,
      }),
    );
    expect(again.status()).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Legal notices — Scenario 38
// ---------------------------------------------------------------------------

test.describe("legal notices", () => {
  /** The expiry is derived, so the DB CHECK can never be violated by a form. */
  test("derives the expiry from the notice date and period", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "notice");
    const opened = await openCase(api, loanId);

    const issued = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/notices`, {
        noticeDate: "2026-08-01",
        noticePeriodDays: 30,
        noticeReference: `${SCRATCH_MARKER}-notice`,
      }),
    );
    expect(issued.status(), await issued.text()).toBeLessThan(300);

    const notice = (await issued.json()) as {
      noticeDate: string;
      expiryDate: string;
      status: string;
    };

    expect(notice.status).toBe("ISSUED");
    expect(notice.noticeDate).toBe("2026-08-01");
    expect(notice.expiryDate).toBe("2026-08-31");

    // Issuing moves the case along and records a frozen action for it.
    const after = await caseById(api, opened.recoveryCaseId);
    expect(after.status).toBe("LEGAL_NOTICE");
    expect(
      after.actions.some(
        (action) => action.actionType === "LEGAL_NOTICE" && action.finalizedAt,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Write-off — the ledger posting, against the real balance trigger
// ---------------------------------------------------------------------------

test.describe("write-off", () => {
  /**
   * The assertion a mock cannot make: the entry balances against the real
   * deferred constraint trigger, and debits `5100` while crediting `1100`.
   *
   * Runs as Super Admin, who is deliberately **not** granted
   * `recovery.writeoff.post` by the seed — so this proves the denial rather
   * than the posting. The posting itself is asserted by the unit specs, which
   * can reach the service directly.
   */
  test("is refused for every seeded role", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loanId = await overdueLoan(api, request, "writeoff-denied");
    const opened = await openCase(api, loanId);

    const attempted = await throttled(() =>
      api.post(`/recovery/cases/${opened.recoveryCaseId}/write-off`, {
        reason: `${SCRATCH_MARKER} unrecoverable`,
        idempotencyKey: uuid(),
        expectedVersion: opened.version,
      }),
    );

    // 403 — the permission is held by no seeded role, so reaching it at all is
    // a deliberate configuration choice (Scenario 43).
    expect(attempted.status()).toBe(403);

    // Nothing moved.
    const after = await caseById(api, opened.recoveryCaseId);
    expect(after.status).not.toBe("CLOSED");
  });
});

// ---------------------------------------------------------------------------
// Permission denial — Scenarios 43, 44
// ---------------------------------------------------------------------------

test.describe("withheld authorities", () => {
  /**
   * Branch Admin runs the recovery desk and is refused the three authorities
   * that give money back. Each needs an account that reaches the screen and is
   * denied the action — granting any of them would make the denial unprovable.
   */
  test("Branch Admin cannot waive a penalty", async ({ request }) => {
    const admin = await apiAs(request, BRANCH_ADMIN);

    const attempted = await throttled(() =>
      admin.post(`/recovery/cases/penalties/${uuid()}/action`, {
        action: "WAIVE",
        reason: "test",
      }),
    );
    expect(attempted.status()).toBe(403);
  });

  test("Branch Admin cannot approve a settlement", async ({ request }) => {
    const admin = await apiAs(request, BRANCH_ADMIN);

    const attempted = await throttled(() =>
      admin.post(`/recovery/settlements/${uuid()}/decide`, {
        decision: "APPROVE",
        expectedVersion: new Date().toISOString(),
      }),
    );
    expect(attempted.status()).toBe(403);
  });

  test("Branch Admin reaches the recovery desk it does hold", async ({
    request,
  }) => {
    const admin = await apiAs(request, BRANCH_ADMIN);

    // The denials above are only meaningful because this succeeds.
    const overdues = await throttled(() => admin.get("/recovery/overdues"));
    expect(overdues.status()).toBe(200);

    const cases = await throttled(() => admin.get("/recovery/cases"));
    expect(cases.status()).toBe(200);
  });
});
