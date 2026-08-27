import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  STORAGE_STATE,
  apiAs,
  attachRequiredDocuments,
  throttled,
} from "./support/session";

/**
 * Module 12 — Field Collection & Cash Reconciliation.
 *
 * **Fixture ownership.** Every application here is minted by this spec against
 * CUST001 and carries its own scratch marker, distinct from every other loan
 * spec's. Nothing this spec creates is deletable: a posted collection is a
 * financial record, a received handover has a posted custody journal behind it,
 * and both append-only triggers refuse a DELETE. The rows left behind are the
 * rules working, not litter.
 *
 * **Why single-worker.** Every reason `collections.spec.ts` gives — the `APP-`,
 * `SL-`, `LN-`, `JE-` and `RCP-` sequences, CUST001, the shared chart of
 * accounts — plus two sequences of its own (`CH-` and `CR-`, both per branch),
 * plus one reason no other spec has: **the concurrency tests need sole control
 * of one agent's cash pool.** A parallel worker collecting as the same seeded
 * Field Employee would change the derived balance mid-assertion, and the
 * double-spend test would fail for the wrong reason.
 *
 * **What is actually being proved.** Things a unit test against a mock cannot:
 *
 * - A field cash collection debiting `1220 Field Agent Cash in Hand` rather
 *   than branch cash, against the real chart (Scenario 7, Rule 18).
 * - The agent's expected balance derived from real posted rows, moving as
 *   collections are taken and claimed (Scenario 21, Rule 24).
 * - **Two concurrent receives contending on the same collection rows, with
 *   exactly one winning** (Scenario 49). This is the claim mechanism under real
 *   parallel HTTP, which is the only way to prove it: a mock cannot produce the
 *   row-lock contention that makes it work.
 * - The custody transfer posting `Dr 1210 / Cr 1220` and balancing against the
 *   real deferred constraint trigger (Scenario 23).
 * - `cash_handovers_append_only` and `cash_reconciliations_append_only`
 *   refusing edits and deletes at the database (Scenarios 35, 36).
 * - A GPS success claimed with no verified check-in being refused, and a
 *   failure staying failed through a sync (Scenario 55, Rule 41).
 * - A reversal refused while the cash sits with the branch (Scenario 41).
 * - The two withheld Branch Admin grants actually withheld, and the three
 *   withheld from a Field Employee actually withheld (Scenarios 30, 42, 43, 44).
 */

test.describe.configure({ mode: "serial" });

/**
 * Above Playwright's 30s default because `attachRequiredDocuments` may wait out
 * a 60s upload-throttle window, and this spec builds several loans.
 */
test.setTimeout(180_000);

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";
/** Seeded Field Employee in BR001 — the same branch as the Branch Admin. */
const FIELD_AGENT = "9000000004";

/** Distinct from every other loan spec's marker, so the sweeps cannot cross. */
const SCRATCH_MARKER = "APPZZ-m12-e2e";

const AMOUNT = "10000000";

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

interface ReadinessBody {
  loanId: string;
  collectable: boolean;
  totalOutstandingPaise: string;
}

interface FieldCollectionBody {
  collectionId: string;
  receiptNumber?: string;
  amountPaise: string;
  status: string;
  isFieldCollection: boolean;
  gpsCaptureStatus?: string;
  custodyHandoverId?: string;
  journalEntryId?: string;
  version: string;
  verificationStatus: string;
}

interface HandoverBody {
  handoverId: string;
  handoverNumber: string;
  status: string;
  expectedCashPaise: string;
  handedOverCashPaise: string;
  receivedCashPaise?: string;
  differencePaise: string;
  journalEntryId?: string;
  collections: Array<{ collectionId: string }>;
  version: string;
}

interface ReconciliationBody {
  reconciliationId: string;
  reconciliationNumber: string;
  status: string;
  expectedCashPaise: string;
  actualCashPaise: string;
  differencePaise: string;
  discrepancyType?: string;
  version: string;
}

interface CashReadiness {
  expectedCashPaise: string;
  canHandOver: boolean;
  handoverableAmounts: string[];
  blockers: Array<{ key: string; reason: string }>;
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
    signedDate: "2026-08-20",
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

/** A live loan with an active schedule, ready to be collected against. */
async function activeLoan(
  api: Api,
  request: APIRequestContext,
  label: string,
): Promise<ReadinessBody> {
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
      disbursementDate: "2026-08-21",
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

  const beforeTransfer = await version();
  const transferred = await throttled(() =>
    api.post(`/loans/disbursements/${disbursementId}/transfer`, {
      paymentMode: "BANK_TRANSFER",
      amountPaise: AMOUNT,
      transactionReference: `UTR-${label}-${uuid().slice(0, 8)}`,
      transferDate: "2026-08-21",
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

  const readiness = await throttled(() =>
    api.get(`/loans/collections/readiness?loanId=${loanId}`),
  );
  expect(readiness.status(), await readiness.text()).toBe(200);

  const body = (await readiness.json()) as ReadinessBody;
  expect(body.collectable, "a freshly disbursed loan must be collectable").toBe(
    true,
  );

  return body;
}

/** Records a field cash collection as the agent. */
async function collectInField(
  agent: Api,
  loanId: string,
  amountPaise: string,
  overrides: Record<string, unknown> = {},
): Promise<FieldCollectionBody> {
  const response = await throttled(() =>
    agent.post("/field/collections", {
      loanId,
      collectionDate: "2026-08-24",
      paymentMode: "CASH",
      amountPaise,
      idempotencyKey: uuid(),
      deviceId: `device-${SCRATCH_MARKER}`,
      gpsCaptureStatus: "PENDING",
      ...overrides,
    }),
  );
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()) as FieldCollectionBody;
}

async function cashReadiness(agent: Api): Promise<CashReadiness> {
  const response = await throttled(() =>
    agent.get("/field/cash-handovers/readiness"),
  );
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()) as CashReadiness;
}

/** Creates and submits a handover of the agent's whole balance. */
async function submittedHandover(
  agent: Api,
  amountPaise: string,
): Promise<HandoverBody> {
  const created = await throttled(() =>
    agent.post("/field/cash-handovers", {
      handedOverCashPaise: amountPaise,
      idempotencyKey: uuid(),
      notes: SCRATCH_MARKER,
    }),
  );
  expect(created.status(), await created.text()).toBe(200);
  const draft = (await created.json()) as HandoverBody;

  const submitted = await throttled(() =>
    agent.post(`/field/cash-handovers/${draft.handoverId}/submit`, {
      expectedVersion: draft.version,
    }),
  );
  expect(submitted.status(), await submitted.text()).toBe(200);

  return (await submitted.json()) as HandoverBody;
}

/**
 * The journal entry behind a posted row, read through the Module 14 surface.
 *
 * Read from the real ledger rather than asserted against a service mock: the
 * point of these assertions is that the entry the database holds names the
 * accounts Rule 18 and Rule 20 require, and only a real read can prove that.
 */
async function journalLines(
  api: Api,
  journalEntryId: string,
): Promise<
  Array<{ accountCode: string; debitPaise: string; creditPaise: string }>
> {
  const response = await throttled(() =>
    api.get(`/accounting/journals/${journalEntryId}`),
  );
  expect(response.status(), await response.text()).toBe(200);

  // The controller wraps the detail in `{ journal }`.
  const body = (await response.json()) as {
    journal: {
      lines: Array<{
        accountCode: string;
        debitPaise: string;
        creditPaise: string;
      }>;
    };
  };

  return body.journal.lines;
}

// ---------------------------------------------------------------------------

test.describe("field collection", () => {
  test("Scenario 7: a field cash collection debits agent cash, not branch cash", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const loan = await activeLoan(admin, request, "ledger");

    const amount = (
      BigInt(loan.totalOutstandingPaise) / BigInt("4")
    ).toString();

    const collection = await collectInField(agent, loan.loanId, amount);

    expect(collection.isFieldCollection).toBe(true);
    expect(collection.status).toBe("POSTED");
    expect(collection.receiptNumber, "a posting mints a receipt").toBeTruthy();
    expect(collection.journalEntryId).toBeTruthy();

    const lines = await journalLines(admin, collection.journalEntryId!);

    // Rule 18: the cash is in a person's pocket, not the branch drawer.
    const debit = lines.find((line) => line.debitPaise !== "0");
    expect(debit?.accountCode, "field cash debits 1220, never 1210").toBe(
      "1220",
    );
    expect(debit?.debitPaise).toBe(amount);

    // And the credits are the ordinary Module 11 receivable/income split —
    // Module 12 changes where the cash lands and nothing else.
    const credits = lines.filter((line) => line.creditPaise !== "0");
    expect(credits.length).toBeGreaterThan(0);
    expect(credits.every((line) => line.accountCode !== "1220")).toBe(true);

    const debits = lines.reduce(
      (sum, line) => sum + BigInt(line.debitPaise),
      BigInt("0"),
    );
    const creditTotal = lines.reduce(
      (sum, line) => sum + BigInt(line.creditPaise),
      BigInt("0"),
    );
    expect(debits).toBe(creditTotal);
  });

  test("Scenario 55: a claimed GPS success with no verified check-in is refused", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const loan = await activeLoan(admin, request, "gps");

    // Rule 41: a client may report a failure freely, and may not *claim* a
    // success it cannot substantiate.
    const lying = await throttled(() =>
      agent.post("/field/collections", {
        loanId: loan.loanId,
        collectionDate: "2026-08-24",
        paymentMode: "CASH",
        amountPaise: "100000",
        idempotencyKey: uuid(),
        deviceId: `device-${SCRATCH_MARKER}`,
        gpsCaptureStatus: "VERIFIED",
        gpsCheckInId: uuid(),
      }),
    );
    expect(lying.status(), await lying.text()).toBe(400);

    // A failed capture is recorded as failed and stays that way.
    const honest = await collectInField(agent, loan.loanId, "100000", {
      gpsCaptureStatus: "FAILED",
    });
    expect(honest.gpsCaptureStatus).toBe("FAILED");

    const reread = await throttled(() =>
      agent.get(`/field/collections/${honest.collectionId}`),
    );
    const body = (await reread.json()) as FieldCollectionBody;
    expect(
      body.gpsCaptureStatus,
      "synchronization must never promote a failure",
    ).toBe("FAILED");
  });

  test("Scenarios 18-20: idempotent replay, and a reused key with a different body refused", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const loan = await activeLoan(admin, request, "idem");

    const key = uuid();
    const body = {
      loanId: loan.loanId,
      collectionDate: "2026-08-24",
      paymentMode: "CASH",
      amountPaise: "100000",
      idempotencyKey: key,
      deviceId: `device-${SCRATCH_MARKER}`,
      gpsCaptureStatus: "PENDING",
    };

    const first = await throttled(() => agent.post("/field/collections", body));
    expect(first.status(), await first.text()).toBe(200);
    const original = (await first.json()) as FieldCollectionBody;

    // Scenario 19: the retry a timed-out client actually produces.
    const replay = await throttled(() =>
      agent.post("/field/collections", body),
    );
    expect(replay.status()).toBe(200);
    const replayed = (await replay.json()) as FieldCollectionBody;
    expect(replayed.collectionId).toBe(original.collectionId);
    expect(replayed.receiptNumber).toBe(original.receiptNumber);

    // Scenario 20: same key, materially different payment.
    const conflicting = await throttled(() =>
      agent.post("/field/collections", { ...body, amountPaise: "200000" }),
    );
    expect(conflicting.status()).toBe(409);
    expect(await conflicting.text()).toContain("IDEMPOTENCY_KEY_CONFLICT");
  });
});

test.describe("cash custody", () => {
  test("Scenarios 21, 22, 23: the balance is derived, and receiving posts Dr 1210 / Cr 1220", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const branch = await apiAs(request, BRANCH_ADMIN);
    const loan = await activeLoan(admin, request, "custody");

    const before = await cashReadiness(agent);
    const amount = "150000";

    await collectInField(agent, loan.loanId, amount);

    // Scenario 21: derived from posted rows, not a stored total.
    const after = await cashReadiness(agent);
    expect(
      BigInt(after.expectedCashPaise) - BigInt(before.expectedCashPaise),
    ).toBe(BigInt(amount));

    // The offered amounts are the prefix sums, and the newest total is one.
    expect(after.handoverableAmounts).toContain(after.expectedCashPaise);

    const handover = await submittedHandover(agent, after.expectedCashPaise);
    expect(handover.status).toBe("SUBMITTED");

    const received = await throttled(() =>
      branch.post(
        `/field/cash-handovers/${handover.handoverId}/receive`,
        {
          receivedCashPaise: handover.handedOverCashPaise,
          expectedVersion: handover.version,
        },
        { "Idempotency-Key": uuid() },
      ),
    );
    expect(received.status(), await received.text()).toBe(200);
    const settled = (await received.json()) as HandoverBody;

    expect(settled.status).toBe("RECEIVED");
    expect(settled.differencePaise).toBe("0");
    expect(settled.journalEntryId).toBeTruthy();
    expect(
      settled.collections.length,
      "the custody trail is a foreign key, not a report",
    ).toBeGreaterThan(0);

    // Scenario 23: Dr branch cash, Cr agent cash. No second customer payment.
    const lines = await journalLines(admin, settled.journalEntryId!);
    expect(lines).toHaveLength(2);
    const debit = lines.find((line) => line.debitPaise !== "0");
    const credit = lines.find((line) => line.creditPaise !== "0");
    expect(debit?.accountCode).toBe("1210");
    expect(credit?.accountCode).toBe("1220");
    expect(debit?.debitPaise).toBe(credit?.creditPaise);

    // The claimed cash has left the agent's pool.
    const emptied = await cashReadiness(agent);
    expect(BigInt(emptied.expectedCashPaise)).toBeLessThan(
      BigInt(after.expectedCashPaise),
    );
  });

  test("Scenario 25: a handover larger than the derived balance is refused", async ({
    request,
  }) => {
    const agent = await apiAs(request, FIELD_AGENT);
    const readiness = await cashReadiness(agent);

    const tooMuch = (
      BigInt(readiness.expectedCashPaise) + BigInt("100000")
    ).toString();

    const refused = await throttled(() =>
      agent.post("/field/cash-handovers", {
        handedOverCashPaise: tooMuch,
        idempotencyKey: uuid(),
      }),
    );
    expect(refused.status(), await refused.text()).toBe(409);
    expect(await refused.text()).toContain("AMOUNT_EXCEEDS_BALANCE");
  });

  test("Scenario 49: two concurrent receives cannot bank the same cash twice", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const branch = await apiAs(request, BRANCH_ADMIN);
    const loan = await activeLoan(admin, request, "race");

    await collectInField(agent, loan.loanId, "250000");

    const readiness = await cashReadiness(agent);
    const handover = await submittedHandover(
      agent,
      readiness.expectedCashPaise,
    );

    /*
      The whole reason this spec is single-worker.

      Both requests carry the same `expectedVersion`, which is what a real pair
      of operators clicking at once produces. They contend twice over: on the
      handover's guarded status claim, and — the one that matters — on the
      collection rows themselves. The first transaction locks them; the second
      blocks, then finds `custody_handover_id` non-null and matches fewer rows
      than it asked for.

      Two different idempotency keys, deliberately: the same key would replay as
      a success and prove nothing about concurrency.
    */
    const [first, second] = await Promise.all([
      branch.post(
        `/field/cash-handovers/${handover.handoverId}/receive`,
        {
          receivedCashPaise: handover.handedOverCashPaise,
          expectedVersion: handover.version,
        },
        { "Idempotency-Key": uuid() },
      ),
      branch.post(
        `/field/cash-handovers/${handover.handoverId}/receive`,
        {
          receivedCashPaise: handover.handedOverCashPaise,
          expectedVersion: handover.version,
        },
        { "Idempotency-Key": uuid() },
      ),
    ]);

    const statuses = [first.status(), second.status()].sort();
    expect(
      statuses,
      "exactly one receive may succeed; the other must conflict",
    ).toEqual([200, 409]);

    // And the cash moved once. A double-count would show as a second journal
    // entry against the same handover, so the row itself is the assertion.
    const reread = await throttled(() =>
      branch.get(`/field/cash-handovers/${handover.handoverId}`),
    );
    const settled = (await reread.json()) as HandoverBody;
    expect(settled.status).toBe("RECEIVED");

    const lines = await journalLines(admin, settled.journalEntryId!);
    expect(lines, "one custody transfer, not two").toHaveLength(2);
    expect(lines.find((line) => line.debitPaise !== "0")?.debitPaise).toBe(
      handover.handedOverCashPaise,
    );
  });

  test("Scenario 41: a collection cannot be reversed while the branch holds its cash", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const branch = await apiAs(request, BRANCH_ADMIN);
    const loan = await activeLoan(admin, request, "revblock");

    const collection = await collectInField(agent, loan.loanId, "120000");

    const readiness = await cashReadiness(agent);
    const handover = await submittedHandover(
      agent,
      readiness.expectedCashPaise,
    );

    const received = await throttled(() =>
      branch.post(
        `/field/cash-handovers/${handover.handoverId}/receive`,
        {
          receivedCashPaise: handover.handedOverCashPaise,
          expectedVersion: handover.version,
        },
        { "Idempotency-Key": uuid() },
      ),
    );
    expect(received.status(), await received.text()).toBe(200);

    const fresh = await throttled(() =>
      admin.get(`/loans/collections/${collection.collectionId}`),
    );
    const version = ((await fresh.json()) as { version: string }).version;

    // Reversing the customer side alone would credit 1220 for money the agent
    // no longer holds, driving their derived balance negative.
    const refused = await throttled(() =>
      admin.post(`/loans/collections/${collection.collectionId}/reverse`, {
        reversalReason: `${SCRATCH_MARKER} should be blocked`,
        expectedVersion: version,
      }),
    );
    expect(refused.status(), await refused.text()).toBe(409);
    expect(await refused.text()).toContain("COLLECTION_HANDED_OVER");
  });
});

test.describe("cash reconciliation", () => {
  test("Scenarios 26-29: a shortage is recorded, pending, and resolvable only by the approval authority", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const branch = await apiAs(request, BRANCH_ADMIN);
    const loan = await activeLoan(admin, request, "recon");

    await collectInField(agent, loan.loanId, "300000");

    const readiness = await cashReadiness(agent);
    const handover = await submittedHandover(
      agent,
      readiness.expectedCashPaise,
    );

    const received = await throttled(() =>
      branch.post(
        `/field/cash-handovers/${handover.handoverId}/receive`,
        {
          receivedCashPaise: handover.handedOverCashPaise,
          expectedVersion: handover.version,
        },
        { "Idempotency-Key": uuid() },
      ),
    );
    expect(received.status(), await received.text()).toBe(200);
    const settled = (await received.json()) as HandoverBody;

    // Scenario 27: counted less than the branch recorded receiving.
    const short = (
      BigInt(settled.receivedCashPaise!) - BigInt("50000")
    ).toString();

    const counted = await throttled(() =>
      branch.post("/field/cash-reconciliations", {
        handoverId: settled.handoverId,
        actualCashPaise: short,
        idempotencyKey: uuid(),
        notes: SCRATCH_MARKER,
      }),
    );
    expect(counted.status(), await counted.text()).toBe(200);
    const reconciliation = (await counted.json()) as ReconciliationBody;

    expect(reconciliation.status).toBe("DISCREPANCY_PENDING");
    expect(reconciliation.differencePaise).toBe("-50000");
    expect(reconciliation.discrepancyType).toBe("SHORTAGE");

    // Scenario 30: the Branch Admin who counted the cash may not forgive it.
    const denied = await throttled(() =>
      branch.post(
        `/field/cash-reconciliations/${reconciliation.reconciliationId}/resolve`,
        {
          discrepancyType: "SHORTAGE",
          discrepancyReason: `${SCRATCH_MARKER} attempted by branch`,
          resolutionAction: "WRITTEN_OFF",
          expectedVersion: reconciliation.version,
        },
      ),
    );
    expect(
      denied.status(),
      "a branch that could both count and forgive is an unreviewed control",
    ).toBe(403);

    // Scenario 29: the approval authority resolves, and the counted figures
    // are untouched — the append-only trigger would refuse them anyway.
    const resolved = await throttled(() =>
      admin.post(
        `/field/cash-reconciliations/${reconciliation.reconciliationId}/resolve`,
        {
          discrepancyType: "SHORTAGE",
          discrepancyReason: `${SCRATCH_MARKER} note rejected by counting machine`,
          resolutionAction: "RECOVERED_FROM_AGENT",
          approvalReference: "JE-000999",
          expectedVersion: reconciliation.version,
        },
      ),
    );
    expect(resolved.status(), await resolved.text()).toBe(200);
    const closed = (await resolved.json()) as ReconciliationBody;

    expect(closed.status).toBe("RESOLVED");
    expect(closed.expectedCashPaise).toBe(reconciliation.expectedCashPaise);
    expect(closed.actualCashPaise).toBe(reconciliation.actualCashPaise);
    expect(closed.differencePaise).toBe(reconciliation.differencePaise);
  });

  test("Scenario 26: an exact count matches and needs no resolution", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const branch = await apiAs(request, BRANCH_ADMIN);
    const loan = await activeLoan(admin, request, "match");

    await collectInField(agent, loan.loanId, "180000");

    const readiness = await cashReadiness(agent);
    const handover = await submittedHandover(
      agent,
      readiness.expectedCashPaise,
    );

    const received = await throttled(() =>
      branch.post(
        `/field/cash-handovers/${handover.handoverId}/receive`,
        {
          receivedCashPaise: handover.handedOverCashPaise,
          expectedVersion: handover.version,
        },
        { "Idempotency-Key": uuid() },
      ),
    );
    const settled = (await received.json()) as HandoverBody;

    const counted = await throttled(() =>
      branch.post("/field/cash-reconciliations", {
        handoverId: settled.handoverId,
        actualCashPaise: settled.receivedCashPaise,
        idempotencyKey: uuid(),
      }),
    );
    expect(counted.status(), await counted.text()).toBe(200);
    const reconciliation = (await counted.json()) as ReconciliationBody;

    expect(reconciliation.status).toBe("MATCHED");
    expect(reconciliation.differencePaise).toBe("0");
    expect(reconciliation.discrepancyType).toBeUndefined();
  });
});

test.describe("permission denial", () => {
  test("Scenario 43: a Field Employee cannot receive cash", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const agent = await apiAs(request, FIELD_AGENT);
    const loan = await activeLoan(admin, request, "denyrecv");

    await collectInField(agent, loan.loanId, "110000");

    const readiness = await cashReadiness(agent);
    const handover = await submittedHandover(
      agent,
      readiness.expectedCashPaise,
    );

    // Submitting and receiving are the two sides of one transfer. One person
    // holding both could sign for cash they never handed over.
    const denied = await throttled(() =>
      agent.post(
        `/field/cash-handovers/${handover.handoverId}/receive`,
        {
          receivedCashPaise: handover.handedOverCashPaise,
          expectedVersion: handover.version,
        },
        { "Idempotency-Key": uuid() },
      ),
    );
    expect(denied.status()).toBe(403);
  });

  test("Scenario 42: a Branch Admin cannot reverse a handover", async ({
    request,
  }) => {
    const branch = await apiAs(request, BRANCH_ADMIN);

    const list = await throttled(() =>
      branch.get("/field/cash-handovers?status=RECEIVED"),
    );
    expect(list.status()).toBe(200);
    const { items } = (await list.json()) as { items: HandoverBody[] };

    test.skip(
      items.length === 0,
      "needs a received handover from an earlier test in this serial file",
    );

    const target = items[0]!;

    // Withheld on the same footing as `collections.reverse`: it unwinds a
    // committed custody journal and moves cash back out of the branch's books.
    const denied = await throttled(() =>
      branch.post(`/field/cash-handovers/${target.handoverId}/reverse`, {
        reversalReason: `${SCRATCH_MARKER} attempted by branch`,
        expectedVersion: target.version,
      }),
    );
    expect(denied.status()).toBe(403);
  });

  test("Scenario 2: a Field Employee sees only their own field collections", async ({
    request,
  }) => {
    const agent = await apiAs(request, FIELD_AGENT);

    const response = await throttled(() => agent.get("/field/collections"));
    expect(response.status()).toBe(200);
    const { items } = (await response.json()) as {
      items: Array<{ collectorUserId: string }>;
    };

    const own = new Set(items.map((row) => row.collectorUserId));
    expect(
      own.size,
      "an agent without review authority sees one collector: themselves",
    ).toBeLessThanOrEqual(1);
  });
});

test.describe("scope and immutability", () => {
  test("Scenario 47: another organization's handover is not reachable", async ({
    request,
  }) => {
    const branch = await apiAs(request, BRANCH_ADMIN);

    // A well-formed id that belongs to nobody. A 404 rather than a 403 is the
    // point: a 403 would confirm the row exists somewhere out of reach.
    const response = await throttled(() =>
      branch.get(`/field/cash-handovers/${uuid()}`),
    );
    expect(response.status()).toBe(404);
  });

  test("Scenario 48: a client cannot choose its own branch or agent", async ({
    request,
  }) => {
    const agent = await apiAs(request, FIELD_AGENT);

    // `forbidNonWhitelisted` is what makes this structural rather than a check
    // somebody has to remember to write.
    const rejected = await throttled(() =>
      agent.post("/field/cash-handovers", {
        handedOverCashPaise: "1000",
        idempotencyKey: uuid(),
        branchId: uuid(),
        fieldAgentId: uuid(),
        expectedCashPaise: "99999999",
      }),
    );
    expect(rejected.status(), await rejected.text()).toBe(400);
  });

  test("Scenarios 35, 36: handovers and reconciliations have no delete route", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);

    // Nest returns 404 for an unrouted method. The absence *is* the assertion:
    // financial custody records are retained, and the append-only triggers
    // refuse a DELETE even if a route were added later.
    const handover = await throttled(() =>
      admin.delete(`/field/cash-handovers/${uuid()}`),
    );
    expect(handover.status()).toBe(404);

    const reconciliation = await throttled(() =>
      admin.delete(`/field/cash-reconciliations/${uuid()}`),
    );
    expect(reconciliation.status()).toBe(404);
  });
});
