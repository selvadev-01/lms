import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  STORAGE_STATE,
  apiAs,
  attachRequiredDocuments,
  throttled,
} from "./support/session";

/**
 * Module 11 — EMI Collection: allocation, posting, receipts, idempotency and
 * reversal.
 *
 * **Fixture ownership.** Every application here is minted by this spec against
 * CUST001 and carries its own scratch marker, distinct from every other loan
 * spec's. Nothing this spec creates is deletable: a posted collection is a
 * financial record (Rules 21, 22, 44), and the `collections_append_only`
 * trigger refuses a DELETE on any collection at all. The rows left behind are
 * the rule working, not litter.
 *
 * **Why single-worker.** Every reason `disbursal.spec.ts` gives — it drives
 * applications to DISBURSED through the same `APP-`, `LN-` and `JE-` sequences,
 * against the same shared chart of accounts and the same CUST001 — plus a
 * fourth sequence of its own: receipts are numbered `RCP-<BRANCH>-000001` upward
 * per branch. Two workers collecting concurrently in the same branch contend on
 * that allocation. `playwright.config.ts` puts this file in the `rbac` project
 * for that reason.
 *
 * **What is actually being proved.** Things a unit test against a mock cannot:
 *
 * - One posting committing across five tables — collection, receipt,
 *   allocations, EMIs and the journal entry with its lines — or none of them.
 * - The double entry balancing against the real deferred constraint trigger,
 *   and crediting Loan Receivable for the principal alone while interest lands
 *   in income (Scenarios 19, 20).
 * - `collections_append_only` refusing an edit and a delete at the database,
 *   which is what makes Scenarios 25, 27 and 28 true rather than merely
 *   unimplemented.
 * - The `RCP-` sequence allocating against a real unique index (Scenarios 15, 16).
 * - Idempotent replay over a real HTTP round trip, which is the shape a
 *   timed-out client actually produces (Scenario 13).
 * - A reused key with a different body refused as a conflict (Scenario 14).
 * - A reversal posting the opposite entry, flipping the original to REVERSED
 *   and leaving its lines untouched (Scenarios 31, 32), with a second reversal
 *   refused by a real unique index (Scenario 33).
 * - A Branch Admin who may post a collection and is denied reversing one —
 *   proving the seventh withheld grant is withheld and the others are not
 *   (Scenario 36).
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

/** Distinct from every other loan spec's marker, so the sweeps cannot cross. */
const SCRATCH_MARKER = "APPZZ-m11-e2e";

/** The sanctioned amount every application here is built with. */
const AMOUNT = "10000000";

type Api = Awaited<ReturnType<typeof apiAs>>;

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

interface CollectionBody {
  collectionId: string;
  loanId: string;
  receiptNumber?: string;
  status: string;
  amountPaise: string;
  penaltyPaidPaise: string;
  interestPaidPaise: string;
  principalPaidPaise: string;
  feesPaidPaise: string;
  unallocatedAmountPaise: string;
  journalEntryId?: string;
  reversalOfCollectionId?: string;
  version: string;
  allocations: Array<{
    installmentNumber: number;
    component: string;
    amountPaise: string;
  }>;
}

interface ReadinessBody {
  loanId: string;
  loanNumber: string;
  collectable: boolean;
  totalOutstandingPaise: string;
  interestOutstandingPaise: string;
  principalOutstandingPaise: string;
  installments: Array<{
    installmentNumber: number;
    totalDuePaise: string;
    paidAmountPaise: string;
    outstandingAmountPaise: string;
    status: string;
  }>;
}

interface LedgerBody {
  entryNumber: string;
  status: string;
  totalDebitPaise: string;
  totalCreditPaise: string;
  balanced: boolean;
  lines: Array<{
    accountCode: string;
    debitPaise: string;
    creditPaise: string;
  }>;
}

const uuid = () => crypto.randomUUID();

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

/** An application driven all the way to AGREEMENT_SIGNED. */
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
    agreementReference: `AGR-${label}`,
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
 * A live loan with an active repayment schedule, ready to be collected against.
 *
 * Built through the real pipeline rather than seeded directly: the collection
 * surface reads the schedule disbursal generated, so a hand-inserted loan would
 * prove nothing about whether the two modules actually meet.
 */
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

  // Resolved before the call rather than inside it: the callback handed to
  // `throttled` is not async, so an `await` in its argument list is a syntax
  // error.
  const beforeTransfer = await version();
  const transferred = await throttled(() =>
    api.post(`/loans/disbursements/${disbursementId}/transfer`, {
      paymentMode: "BANK_TRANSFER",
      amountPaise: AMOUNT,
      // Unique per run, not per label: `transaction_reference` is unique at
      // organization scope, so a fixed value collides with the previous run's
      // row on the second execution against the same database.
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

async function post(
  api: Api,
  loanId: string,
  amountPaise: string,
  idempotencyKey = uuid(),
): Promise<CollectionBody> {
  const response = await throttled(() =>
    api.post("/loans/collections", {
      loanId,
      collectionDate: "2026-08-22",
      paymentMode: "CASH",
      amountPaise,
      idempotencyKey,
    }),
  );
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()) as CollectionBody;
}

test.describe("EMI collection", () => {
  test("Scenarios 6, 7, 8: allocation is ordered, exhaustive and repeatable", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "alloc");

    const partial = (
      BigInt(loan.totalOutstandingPaise) / BigInt("3")
    ).toString();

    const preview = await throttled(() =>
      api.post("/loans/collections/preview-allocation", {
        loanId: loan.loanId,
        amountPaise: partial,
      }),
    );
    expect(preview.status(), await preview.text()).toBe(200);

    const body = (await preview.json()) as {
      penaltyPaise: string;
      interestPaise: string;
      principalPaise: string;
      feesPaise: string;
      unallocatedPaise: string;
      lines: Array<{ installmentNumber: number; component: string }>;
    };

    // The identity the database CHECK also enforces.
    const summed =
      BigInt(body.penaltyPaise) +
      BigInt(body.interestPaise) +
      BigInt(body.principalPaise) +
      BigInt(body.feesPaise) +
      BigInt(body.unallocatedPaise);
    expect(summed.toString()).toBe(partial);
    expect(body.unallocatedPaise).toBe("0");

    // Oldest installment first, and within each: penalty, interest, principal.
    const rank: Record<string, number> = {
      PENALTY: 0,
      INTEREST: 1,
      PRINCIPAL: 2,
      FEE: 3,
    };
    let previousInstallment = 0;
    for (const line of body.lines) {
      expect(line.installmentNumber).toBeGreaterThanOrEqual(
        previousInstallment,
      );
      previousInstallment = line.installmentNumber;
    }
    for (const installment of new Set(
      body.lines.map((l) => l.installmentNumber),
    )) {
      const components = body.lines
        .filter((l) => l.installmentNumber === installment)
        .map((l) => rank[l.component]!);
      expect([...components].sort((a, b) => a - b)).toEqual(components);
    }

    // Scenario 8: the same balances and amount produce the same split.
    const again = await throttled(() =>
      api.post("/loans/collections/preview-allocation", {
        loanId: loan.loanId,
        amountPaise: partial,
      }),
    );
    expect(await again.json()).toEqual(body);
  });

  test("Scenarios 19, 20: posting writes a balanced entry crediting income and receivable", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "ledger");

    const amount = (
      BigInt(loan.totalOutstandingPaise) / BigInt("4")
    ).toString();
    const collection = await post(api, loan.loanId, amount);

    expect(collection.status).toBe("POSTED");
    expect(collection.receiptNumber).toMatch(/^RCP-[A-Za-z0-9_-]+-\d{6}$/);
    expect(collection.allocations.length).toBeGreaterThan(0);

    const ledger = await throttled(() =>
      api.get(`/loans/collections/${collection.collectionId}/ledger`),
    );
    expect(ledger.status(), await ledger.text()).toBe(200);
    const entry = (await ledger.json()) as LedgerBody;

    // Balanced against the real deferred trigger, not a client-side sum.
    expect(entry.balanced).toBe(true);
    expect(entry.totalDebitPaise).toBe(entry.totalCreditPaise);
    expect(entry.totalDebitPaise).toBe(amount);

    // Cash is debited; interest lands in income and only the principal portion
    // touches Loan Receivable. That split is the whole accounting resolution.
    const cash = entry.lines.find((l) => l.accountCode === "1210");
    expect(cash?.debitPaise).toBe(amount);

    if (BigInt(collection.interestPaidPaise) > BigInt("0")) {
      const income = entry.lines.find((l) => l.accountCode === "4100");
      expect(income?.creditPaise).toBe(collection.interestPaidPaise);
    }

    const receivable = entry.lines.filter((l) => l.accountCode === "1100");
    if (BigInt(collection.principalPaidPaise) > BigInt("0")) {
      expect(receivable).toHaveLength(1);
      expect(receivable[0]!.creditPaise).toBe(collection.principalPaidPaise);
    } else {
      expect(receivable).toHaveLength(0);
    }
  });

  test("Scenarios 22, 23: the schedule moves and the contractual amounts do not", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "schedule");

    const before = loan.installments[0]!;
    const amount = (
      BigInt(before.outstandingAmountPaise) / BigInt("2")
    ).toString();

    await post(api, loan.loanId, amount);

    const after = await throttled(() =>
      api.get(`/loans/collections/readiness?loanId=${loan.loanId}`),
    );
    const updated = (await after.json()) as ReadinessBody;

    // The whole loan fell by exactly what was collected.
    expect(BigInt(updated.totalOutstandingPaise)).toBe(
      BigInt(loan.totalOutstandingPaise) - BigInt(amount),
    );

    const row = updated.installments[0]!;
    expect(row.status).toBe("PARTIALLY_PAID");
    expect(row.paidAmountPaise).toBe(amount);
    // Rules 16, 17: the contractual figure is untouched and still reconciles.
    expect(row.totalDuePaise).toBe(before.totalDuePaise);
    expect(
      BigInt(row.paidAmountPaise) + BigInt(row.outstandingAmountPaise),
    ).toBe(BigInt(row.totalDuePaise));
  });

  test("Scenarios 13, 14: a retry replays and a reused key with a different body is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "idem");

    const key = uuid();
    const amount = "100000";
    const first = await post(api, loan.loanId, amount, key);

    // Scenario 13: the same request again returns the same posting.
    const replay = await post(api, loan.loanId, amount, key);
    expect(replay.collectionId).toBe(first.collectionId);
    expect(replay.receiptNumber).toBe(first.receiptNumber);
    expect(replay.journalEntryId).toBe(first.journalEntryId);

    // And created nothing: one collection, one receipt number.
    const list = await throttled(() =>
      api.get(`/loans/${loan.loanId}/collections`),
    );
    const { collections } = (await list.json()) as {
      collections: Array<{ receiptNumber?: string }>;
    };
    expect(
      collections.filter((c) => c.receiptNumber === first.receiptNumber),
    ).toHaveLength(1);

    // Scenario 14: the same key with a materially different payment.
    const conflict = await throttled(() =>
      api.post("/loans/collections", {
        loanId: loan.loanId,
        collectionDate: "2026-08-22",
        paymentMode: "CASH",
        amountPaise: "200000",
        idempotencyKey: key,
      }),
    );
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()) as { code?: string }).toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });
  });

  test("Scenarios 25, 27, 28: a posted collection cannot be edited or deleted", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "immutable");
    const collection = await post(api, loan.loanId, "100000");

    // There is no edit or delete route at all — the absence is the point, and
    // the database trigger is the backstop behind it.
    for (const attempt of [
      api.patch(`/loans/collections/${collection.collectionId}`, {
        amountPaise: "1",
      }),
      api.put(`/loans/collections/${collection.collectionId}`, {
        amountPaise: "1",
      }),
      api.delete(`/loans/collections/${collection.collectionId}`),
    ]) {
      const response = await throttled(() => attempt);
      expect(response.status()).toBeGreaterThanOrEqual(400);
    }

    // And it is still exactly as posted.
    const after = await throttled(() =>
      api.get(`/loans/collections/${collection.collectionId}`),
    );
    const body = (await after.json()) as CollectionBody;
    expect(body.amountPaise).toBe("100000");
    expect(body.status).toBe("POSTED");
  });

  test("Scenarios 31, 32, 33: reversal mirrors the entry, preserves the original and happens once", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "reverse");
    const collection = await post(api, loan.loanId, "100000");

    const outstandingBefore = (
      await (
        await throttled(() =>
          api.get(`/loans/collections/readiness?loanId=${loan.loanId}`),
        )
      ).json()
    ).totalOutstandingPaise as string;

    const reversed = await throttled(() =>
      api.post(`/loans/collections/${collection.collectionId}/reverse`, {
        reversalReason: `${SCRATCH_MARKER} collected against the wrong loan`,
        expectedVersion: collection.version,
      }),
    );
    expect(reversed.status(), await reversed.text()).toBe(200);
    const reversal = (await reversed.json()) as CollectionBody;

    expect(reversal.reversalOfCollectionId).toBe(collection.collectionId);
    // Rule 20: a reversal is not a receipt and never reuses one.
    expect(reversal.receiptNumber).toBeFalsy();

    // Scenario 31: the original is preserved, marked, and keeps every figure.
    const original = await throttled(() =>
      api.get(`/loans/collections/${collection.collectionId}`),
    );
    const originalBody = (await original.json()) as CollectionBody;
    expect(originalBody.status).toBe("REVERSED");
    expect(originalBody.receiptNumber).toBe(collection.receiptNumber);
    expect(originalBody.principalPaidPaise).toBe(collection.principalPaidPaise);

    // Scenario 32: an opposite balanced entry, and the original's lines intact.
    const reversalLedger = (await (
      await throttled(() =>
        api.get(`/loans/collections/${reversal.collectionId}/ledger`),
      )
    ).json()) as LedgerBody;
    expect(reversalLedger.balanced).toBe(true);
    expect(reversalLedger.totalDebitPaise).toBe(collection.amountPaise);
    expect(
      reversalLedger.lines.find((l) => l.accountCode === "1210")?.creditPaise,
    ).toBe(collection.amountPaise);

    const originalLedger = (await (
      await throttled(() =>
        api.get(`/loans/collections/${collection.collectionId}/ledger`),
      )
    ).json()) as LedgerBody;
    expect(originalLedger.status).toBe("REVERSED");
    expect(originalLedger.totalDebitPaise).toBe(collection.amountPaise);

    // The borrower owes it again.
    const restored = (await (
      await throttled(() =>
        api.get(`/loans/collections/readiness?loanId=${loan.loanId}`),
      )
    ).json()) as ReadinessBody;
    expect(BigInt(restored.totalOutstandingPaise)).toBe(
      BigInt(outstandingBefore) + BigInt(collection.amountPaise),
    );

    // Scenario 33: refused by a real unique index, not by a remembered check.
    const twice = await throttled(() =>
      api.post(`/loans/collections/${collection.collectionId}/reverse`, {
        reversalReason: `${SCRATCH_MARKER} again`,
        expectedVersion: originalBody.version,
      }),
    );
    expect(twice.status()).toBe(409);
  });

  test("Scenario 26: a stale version cannot reverse", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "stale");
    const collection = await post(api, loan.loanId, "100000");

    const stale = await throttled(() =>
      api.post(`/loans/collections/${collection.collectionId}/reverse`, {
        reversalReason: `${SCRATCH_MARKER} stale`,
        expectedVersion: "2020-01-01T00:00:00.000Z",
      }),
    );
    expect(stale.status()).toBe(409);

    const after = await throttled(() =>
      api.get(`/loans/collections/${collection.collectionId}`),
    );
    expect(((await after.json()) as CollectionBody).status).toBe("POSTED");
  });

  test("Scenarios 9, 10, 11, 45: an invalid amount or missing reference is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "validation");

    for (const amountPaise of ["0", "-100", "1000.50", "1e5"]) {
      const response = await throttled(() =>
        api.post("/loans/collections", {
          loanId: loan.loanId,
          collectionDate: "2026-08-22",
          paymentMode: "CASH",
          amountPaise,
          idempotencyKey: uuid(),
        }),
      );
      expect(response.status(), `amount ${amountPaise}`).toBe(400);
    }

    // Scenario 45: a bank transfer must carry the payer's reference.
    const noReference = await throttled(() =>
      api.post("/loans/collections", {
        loanId: loan.loanId,
        collectionDate: "2026-08-22",
        paymentMode: "BANK_TRANSFER",
        amountPaise: "100000",
        idempotencyKey: uuid(),
      }),
    );
    expect(noReference.status()).toBe(400);

    // Overpayment is refused rather than held as credit, and the ceiling is
    // named so the form can offer it.
    const over = await throttled(() =>
      api.post("/loans/collections", {
        loanId: loan.loanId,
        collectionDate: "2026-08-22",
        paymentMode: "CASH",
        amountPaise: (
          BigInt(loan.totalOutstandingPaise) + BigInt("1")
        ).toString(),
        idempotencyKey: uuid(),
      }),
    );
    expect(over.status()).toBe(400);
    expect(
      (await over.json()) as { maxCollectablePaise?: string },
    ).toMatchObject({ maxCollectablePaise: loan.totalOutstandingPaise });
  });

  test("Scenario 36: a Branch Admin may post a collection and is denied reversing one", async ({
    request,
  }) => {
    const superAdmin = await apiAs(request, SUPER_ADMIN);
    const branchAdmin = await apiAs(request, BRANCH_ADMIN);
    const loan = await activeLoan(superAdmin, request, "rbac");

    // The grants a Branch Admin does hold.
    const posted = await throttled(() =>
      branchAdmin.post("/loans/collections", {
        loanId: loan.loanId,
        collectionDate: "2026-08-22",
        paymentMode: "CASH",
        amountPaise: "100000",
        idempotencyKey: uuid(),
      }),
    );
    expect(posted.status(), await posted.text()).toBe(200);
    const collection = (await posted.json()) as CollectionBody;

    // And the one deliberately withheld. Granting `collections.reverse` in the
    // seed would silently make this assertion unprovable.
    const denied = await throttled(() =>
      branchAdmin.post(
        `/loans/collections/${collection.collectionId}/reverse`,
        {
          reversalReason: `${SCRATCH_MARKER} should be denied`,
          expectedVersion: collection.version,
        },
      ),
    );
    expect(denied.status()).toBe(403);

    // The refusal changed nothing.
    const after = await throttled(() =>
      superAdmin.get(`/loans/collections/${collection.collectionId}`),
    );
    expect(((await after.json()) as CollectionBody).status).toBe("POSTED");
  });

  test("Scenarios 1, 4, 38: an unreachable collection is 404, never 403", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const ghost = await throttled(() =>
      api.get(`/loans/collections/${uuid()}`),
    );
    expect(ghost.status()).toBe(404);
  });
});

test.describe("EMI collection — screens", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("Scenarios 1, 2, 3: the list and detail render a posted collection", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const loan = await activeLoan(api, request, "ui");
    const collection = await post(api, loan.loanId, "100000");

    // Scenario 1: the collection this test just posted is on the list, linked
    // to its own detail page. `.first()` because the seeded database
    // accumulates collections across runs and the branch receipt sequence
    // restarts with the seed, so the number is not unique across all history —
    // what matters is that the row is rendered and its href is right.
    //
    // **Searched for rather than scanned off page one.** The list is paginated
    // at 20 and the accumulated fixtures long ago outgrew that, so an
    // unfiltered visit renders the twenty newest rows and this receipt is not
    // among them. Without the filter the assertion passes on a fresh database
    // and starts failing as soon as any spec adds enough loans — which looks
    // like a regression in the list screen when it is only this line being
    // written against a page rather than against a query.
    await page.goto(
      `/loans/collections?search=${encodeURIComponent(collection.receiptNumber!)}`,
    );
    const link = page
      .getByRole("link", { name: collection.receiptNumber! })
      .first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      `/loans/collections/${collection.collectionId}`,
    );

    await page.goto(`/loans/collections/${collection.collectionId}`);

    // Scenario 2: the allocation is on screen. Scoped to the headings rather
    // than to bare text — "Interest" also appears in the per-installment table
    // and in the ledger's line descriptions, so a loose text match resolves to
    // three elements and fails strict mode.
    await expect(
      page.getByRole("heading", { name: "Allocation" }),
    ).toBeVisible();

    const allocation = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Allocation" }) });
    // `getByRole("term")` rather than text: each component label appears twice
    // in this section — once as a <dt> in the summary and again as a <td> in the
    // per-installment table — so a text match resolves to two elements.
    await expect(
      allocation.getByRole("term").filter({ hasText: /^Penalty$/ }),
    ).toBeVisible();
    await expect(
      allocation.getByRole("term").filter({ hasText: /^Interest$/ }),
    ).toBeVisible();
    await expect(
      allocation.getByRole("term").filter({ hasText: /^Principal$/ }),
    ).toBeVisible();
    await expect(
      allocation.getByRole("term").filter({ hasText: /^Total$/ }),
    ).toBeVisible();

    // Scenario 3: so is the ledger posting.
    await expect(
      page.getByRole("heading", { name: "Ledger entry" }),
    ).toBeVisible();
  });
});
