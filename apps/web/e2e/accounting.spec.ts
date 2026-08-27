import { expect, test } from "@playwright/test";

import {
  STORAGE_STATE,
  apiAs,
  throttled,
  type ApiClient,
} from "./support/session";

/**
 * Module 14 — Accounting & Ledger: chart of accounts, manual journals, posting,
 * reversal, the general ledger and reconciliation.
 *
 * **Fixture ownership.** Every account and journal here is minted by this spec
 * and carries the `ACCTZZ-m14-e2e` marker, distinct from every other spec's.
 * Nothing this spec posts is deletable: a posted journal is a financial record
 * and `journal_entries_append_only` refuses a DELETE on one. The rows left
 * behind are the rule working, not litter.
 *
 * **This spec must never touch the six seeded accounts.** `1100`, `1200`,
 * `1210`, `4100`, `4200` and `4300` are what `disbursal.spec.ts` and
 * `collections.spec.ts` post through. Deactivating one — or deleting it — would
 * break both, and the failure would surface in those specs rather than here.
 * Every account this spec deactivates is one it created.
 *
 * **Why single-worker.** It allocates from the same per-organization `JE-`
 * sequence that `disbursal.spec.ts` and `collections.spec.ts` allocate from,
 * and it reads the shared chart of accounts those specs post against. Two
 * workers posting journals concurrently contend on that allocation, and the
 * loser's whole transaction rolls back — which would surface as intermittent
 * failure rather than as the contention it is. `playwright.config.ts` puts this
 * file in the `rbac` project for that reason.
 *
 * **What is actually being proved.** Things a unit test against a fake cannot:
 *
 * - An unbalanced DRAFT being *accepted*, which is the whole point of the
 *   Module 14 trigger rewrite: the pre-existing `journal_lines_balanced`
 *   constraint trigger refused it, and a draft has to be allowed to be
 *   mid-build (Scenario 12).
 * - The same draft being refused at POST by `assert_entry_postable`, so the
 *   balance decision genuinely moved to the DRAFT -> POSTED transition
 *   (Scenarios 13, 61).
 * - A draft's lines being edited and deleted, which the old
 *   `journal_lines_append_only` trigger made impossible (Scenario 35). A
 *   BEFORE trigger returning the wrong record would cancel the delete silently,
 *   so the row count is asserted rather than the absence of an error.
 * - `journal_entries_append_only` refusing an edit and a delete on a posted
 *   entry at the database (Scenarios 36, 37).
 * - A reversal posting the opposite entry, flipping the original to REVERSED
 *   and leaving its lines untouched (Scenarios 39, 40), with a second reversal
 *   refused (Scenario 41).
 * - Idempotent replay over a real HTTP round trip, which is the shape a
 *   timed-out client actually produces (Scenario 25), and a reused key with a
 *   different body refused as a conflict (Scenario 26).
 * - The trial balance summing to zero across every posting the seeded modules
 *   made — the assertion the module exists to support.
 * - A Branch Admin who may author a draft and is denied posting it, reversing
 *   one, managing accounts and running reconciliation: the four withheld grants
 *   (Scenarios 44, 48, 49, 50).
 */

test.describe.configure({ mode: "serial" });

/**
 * Raised from 150s when `throttled` began waiting out two rate-limit windows
 * rather than one. Two waits is ~122s, which left under 30s for the requests
 * themselves — so a test that hit the limiter twice would fail on a timeout
 * rather than on anything it was asserting.
 */
test.setTimeout(240_000);

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";

/** Distinct per spec so one spec's cleanup sweep cannot cross into another's. */
const SCRATCH_MARKER = "ACCTZZ-m14-e2e";

/** The seeded accounts other specs post through. Never mutated here. */
const SEEDED_CODES = ["1100", "1200", "1210", "4100", "4200", "4300"];

interface AccountRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  isManualPostingAllowed: boolean;
  status: string;
  version: string;
}

interface JournalRow {
  journalEntryId: string;
  entryNumber: string;
  entryType: string;
  status: string;
  balanced: boolean;
  version: string;
  totalDebitPaise: string;
  totalCreditPaise: string;
  lines: Array<{
    accountCode: string;
    debitPaise: string;
    creditPaise: string;
  }>;
  canPost: boolean;
  canReverse: boolean;
  originalEntryNumber?: string;
}

/**
 * The chart, fetched once per role and replayed.
 *
 * Reads are rate limited per IP, and a spec of this size resolving an account
 * code before every assertion exhausts the budget — which surfaces as a 429 on
 * an unrelated test rather than as the read-volume problem it is. The chart does
 * not change under this spec except for accounts it creates and removes within
 * a single test, so one fetch per role is sound.
 */
const chartCache = new Map<string, AccountRow[]>();

async function accounts(
  api: ApiClient,
  cacheKey = "default",
): Promise<AccountRow[]> {
  const cached = chartCache.get(cacheKey);
  if (cached) return cached;

  // Wrapped because this spec shares its rate-limit budget with every other
  // spec in the `rbac` group, and a 429 here would surface as a missing account
  // rather than as the throttle it is.
  const response = await throttled(() =>
    api.get("/accounting/accounts?pageSize=100"),
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { accounts: AccountRow[] };
  chartCache.set(cacheKey, body.accounts);
  return body.accounts;
}

async function accountByCode(
  api: ApiClient,
  code: string,
  cacheKey = "default",
): Promise<AccountRow> {
  const found = (await accounts(api, cacheKey)).find(
    (a) => a.accountCode === code,
  );
  expect(found, `account ${code} should exist`).toBeTruthy();
  return found!;
}

async function journal(
  api: ApiClient,
  journalEntryId: string,
): Promise<JournalRow> {
  const response = await throttled(() =>
    api.get(`/accounting/journals/${journalEntryId}`),
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { journal: JournalRow };
  return body.journal;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** A two-line journal body, debit and credit given separately so it can be unbalanced. */
function draftBody(
  debitAccountId: string,
  creditAccountId: string,
  debitPaise: string,
  creditPaise: string,
  suffix: string,
) {
  return {
    entryDate: "2026-08-23",
    entryType: "MANUAL" as const,
    description: `${SCRATCH_MARKER} ${suffix}`,
    idempotencyKey: uuid(),
    lines: [
      { accountId: debitAccountId, debitPaise, creditPaise: "0" },
      { accountId: creditAccountId, debitPaise: "0", creditPaise },
    ],
  };
}

test.describe("Module 14 — chart of accounts", () => {
  test("lists the seeded chart, with the control account closed to manual posting", async ({
    request,
  }) => {
    // Scenarios 1, 3. 1100 Loan Receivable is driven by the loan book, so a
    // hand-written journal must not be able to reach it.
    const api = await apiAs(request, SUPER_ADMIN);
    // Uncached: this test is about what the chart actually contains.
    const chart = await accounts(api, `fresh-${Date.now()}`);

    for (const code of SEEDED_CODES) {
      expect(
        chart.some((a) => a.accountCode === code),
        `seeded account ${code} should be present`,
      ).toBe(true);
    }

    const control = chart.find((a) => a.accountCode === "1100")!;
    expect(control.isManualPostingAllowed).toBe(false);

    const bank = chart.find((a) => a.accountCode === "1200")!;
    expect(bank.isManualPostingAllowed).toBe(true);
  });

  test("refuses a duplicate account code", async ({ request }) => {
    // Scenario 5. The unique index is the guarantee; this asserts the wording.
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.post("/accounting/accounts", {
      accountCode: "1100",
      accountName: `${SCRATCH_MARKER} duplicate probe`,
      accountType: "ASSET",
      normalBalance: "DEBIT",
      status: "ACTIVE",
    });

    expect(response.status()).toBe(409);
    expect(await response.text()).toContain("already used");
  });

  test("refuses to delete an account posted ledger lines reference", async ({
    request,
  }) => {
    // Scenario 10. 1100 has been posted to by every seeded disbursal, so this
    // must refuse and must name what is holding it.
    const api = await apiAs(request, SUPER_ADMIN);
    const control = await accountByCode(api, "1100");

    const response = await api.delete(
      `/accounting/accounts/${control.accountId}`,
    );

    expect(response.status()).toBe(409);
    const body = (await response.json()) as {
      blockedBy?: Array<{ entity: string; count: number }>;
    };
    expect(body.blockedBy?.length).toBeGreaterThan(0);
    expect(
      body.blockedBy!.some((b) => b.entity === "journalLine" && b.count > 0),
    ).toBe(true);
  });

  test("creates, deactivates and deletes an account of its own", async ({
    request,
  }) => {
    // Scenarios 4, 9, and the delete path that actually succeeds. The account is
    // this spec's own, so deactivating it cannot disturb the other money specs.
    const api = await apiAs(request, SUPER_ADMIN);
    const code = `ZZ${Date.now().toString().slice(-6)}`;

    const created = await api.post("/accounting/accounts", {
      accountCode: code,
      accountName: `${SCRATCH_MARKER} scratch suspense`,
      accountType: "ASSET",
      normalBalance: "DEBIT",
      status: "ACTIVE",
    });
    expect(created.status()).toBe(201);
    const account = ((await created.json()) as { account: AccountRow }).account;

    const deactivated = await api.post(
      `/accounting/accounts/${account.accountId}/deactivate`,
      { reason: "e2e", expectedVersion: account.version },
    );
    expect(deactivated.status()).toBe(200);
    const after = ((await deactivated.json()) as { account: AccountRow })
      .account;
    expect(after.status).toBe("INACTIVE");

    // Nothing references it, so this one is genuinely removable — which is what
    // makes the refusal above a rule rather than a blanket prohibition.
    const removed = await api.delete(
      `/accounting/accounts/${account.accountId}`,
    );
    expect(removed.status()).toBe(200);
  });

  test("refuses a normal balance that contradicts the account type", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.post("/accounting/accounts", {
      accountCode: `ZZ${Date.now().toString().slice(-6)}X`,
      accountName: `${SCRATCH_MARKER} wrong side`,
      accountType: "ASSET",
      normalBalance: "CREDIT",
      status: "ACTIVE",
    });

    expect(response.status()).toBe(409);
    expect(await response.text()).toContain("normally carries a debit");
  });
});

test.describe("Module 14 — the draft lifecycle the trigger rewrite created", () => {
  test("accepts an unbalanced draft, then refuses to post it", async ({
    request,
  }) => {
    // Scenarios 12, 13, 61 — and the core of the Module 14 migration. The
    // pre-existing `journal_lines_balanced` trigger refused an unbalanced
    // draft at COMMIT; the rewrite exempts DRAFT and moves the decision to
    // `assert_entry_postable` on the DRAFT -> POSTED transition.
    const api = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const created = await api.post(
      "/accounting/journals",
      draftBody(
        bank.accountId,
        income.accountId,
        "50000",
        "40000",
        "unbalanced draft",
      ),
    );

    expect(created.status()).toBe(200);
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    expect(draft.status).toBe("DRAFT");
    expect(draft.balanced).toBe(false);
    expect(draft.lines).toHaveLength(2);

    const posted = await api.post(
      `/accounting/journals/${draft.journalEntryId}/post`,
      { expectedVersion: draft.version },
      { "Idempotency-Key": uuid() },
    );

    expect(posted.status()).toBe(409);
    expect(await posted.text()).toContain(
      "Total debit must equal total credit",
    );

    // Still a draft, and still unbalanced: the refusal changed nothing.
    const unchanged = await journal(api, draft.journalEntryId);
    expect(unchanged.status).toBe("DRAFT");
    expect(unchanged.balanced).toBe(false);
  });

  test("edits a draft's lines, replacing them wholesale", async ({
    request,
  }) => {
    // Scenario 35. The old `journal_lines_append_only` trigger refused every
    // UPDATE and DELETE on a line; the rewrite permits both while the parent is
    // a DRAFT. The line count is asserted because a BEFORE trigger returning
    // the wrong record cancels a DELETE with no error.
    const api = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");
    const cash = await accountByCode(api, "1210");

    const created = await api.post(
      "/accounting/journals",
      draftBody(
        bank.accountId,
        income.accountId,
        "50000",
        "40000",
        "draft to edit",
      ),
    );
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    // Three lines now, and balanced — so the delete of the old two genuinely
    // happened rather than the new ones being appended alongside them.
    const edited = await api.patch(
      `/accounting/journals/${draft.journalEntryId}`,
      {
        entryDate: "2026-08-23",
        entryType: "MANUAL",
        description: `${SCRATCH_MARKER} edited to balance`,
        expectedVersion: draft.version,
        lines: [
          { accountId: bank.accountId, debitPaise: "30000", creditPaise: "0" },
          { accountId: cash.accountId, debitPaise: "20000", creditPaise: "0" },
          {
            accountId: income.accountId,
            debitPaise: "0",
            creditPaise: "50000",
          },
        ],
      },
    );

    expect(edited.status()).toBe(200);
    const after = ((await edited.json()) as { journal: JournalRow }).journal;

    expect(after.lines).toHaveLength(3);
    expect(after.balanced).toBe(true);
    expect(after.totalDebitPaise).toBe("50000");
    expect(after.totalCreditPaise).toBe("50000");
  });

  test("refuses a stale draft edit", async ({ request }) => {
    // Scenario 57.
    const api = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const created = await api.post(
      "/accounting/journals",
      draftBody(
        bank.accountId,
        income.accountId,
        "1000",
        "1000",
        "stale probe",
      ),
    );
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    const response = await api.patch(
      `/accounting/journals/${draft.journalEntryId}`,
      {
        entryDate: "2026-08-23",
        entryType: "MANUAL",
        description: `${SCRATCH_MARKER} stale`,
        expectedVersion: "2020-01-01T00:00:00.000Z",
        lines: [
          { accountId: bank.accountId, debitPaise: "1", creditPaise: "0" },
          { accountId: income.accountId, debitPaise: "0", creditPaise: "1" },
        ],
      },
    );

    expect(response.status()).toBe(409);
    expect(await response.text()).toContain("changed since you opened it");

    await api.delete(`/accounting/journals/${draft.journalEntryId}`);
  });

  test("discards a draft, and the row is genuinely gone", async ({
    request,
  }) => {
    // Scenario 38, and the return-value trap: the rewritten
    // `reject_posted_journal_entry_mutation` must return OLD for a DRAFT
    // delete, or the operation is cancelled with no error and the row survives.
    const api = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const created = await api.post(
      "/accounting/journals",
      draftBody(
        bank.accountId,
        income.accountId,
        "2500",
        "2500",
        "draft to discard",
      ),
    );
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    const removed = await api.delete(
      `/accounting/journals/${draft.journalEntryId}`,
    );
    expect(removed.status()).toBe(200);

    const gone = await api.get(`/accounting/journals/${draft.journalEntryId}`);
    expect(gone.status()).toBe(404);
  });

  test("refuses to post to an account closed to manual journals", async ({
    request,
  }) => {
    // Rule 39. 1100 is the control account the loan book drives.
    const api = await apiAs(request, SUPER_ADMIN);
    const control = await accountByCode(api, "1100");
    const income = await accountByCode(api, "4100");

    const created = await api.post(
      "/accounting/journals",
      draftBody(
        control.accountId,
        income.accountId,
        "1000",
        "1000",
        "control probe",
      ),
    );
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    const posted = await api.post(
      `/accounting/journals/${draft.journalEntryId}/post`,
      { expectedVersion: draft.version },
      { "Idempotency-Key": uuid() },
    );

    expect(posted.status()).toBe(409);
    expect(await posted.text()).toContain("not open to manual posting");

    await api.delete(`/accounting/journals/${draft.journalEntryId}`);
  });
});

test.describe("Module 14 — posting, immutability and reversal", () => {
  /** A balanced draft, posted. Returns the posted entry. */
  async function postBalanced(
    api: ApiClient,
    suffix: string,
  ): Promise<JournalRow> {
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const created = await api.post(
      "/accounting/journals",
      draftBody(bank.accountId, income.accountId, "50000", "50000", suffix),
    );
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    const posted = await api.post(
      `/accounting/journals/${draft.journalEntryId}/post`,
      { expectedVersion: draft.version },
      { "Idempotency-Key": uuid() },
    );
    expect(posted.status()).toBe(200);

    return ((await posted.json()) as { journal: JournalRow }).journal;
  }

  test("posts a balanced draft and stamps it", async ({ request }) => {
    // Scenario 28.
    const api = await apiAs(request, SUPER_ADMIN);
    const entry = await postBalanced(api, "posted entry");

    expect(entry.status).toBe("POSTED");
    expect(entry.balanced).toBe(true);
    expect(entry.entryNumber).toMatch(/^JE-\d{6}$/);
    expect(entry.canPost).toBe(false);
    expect(entry.canReverse).toBe(true);
  });

  test("refuses an edit and a delete on a posted entry", async ({
    request,
  }) => {
    // Scenarios 36, 37. `journal_entries_append_only` refuses both at the
    // database; the service refuses first so the message is legible.
    const api = await apiAs(request, SUPER_ADMIN);
    const entry = await postBalanced(api, "immutability probe");
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const edited = await api.patch(
      `/accounting/journals/${entry.journalEntryId}`,
      {
        entryDate: "2026-08-23",
        entryType: "MANUAL",
        description: `${SCRATCH_MARKER} should not apply`,
        expectedVersion: entry.version,
        lines: [
          { accountId: bank.accountId, debitPaise: "1", creditPaise: "0" },
          { accountId: income.accountId, debitPaise: "0", creditPaise: "1" },
        ],
      },
    );
    expect(edited.status()).toBe(409);

    const removed = await api.delete(
      `/accounting/journals/${entry.journalEntryId}`,
    );
    expect(removed.status()).toBe(409);

    // Unchanged: still posted, still the same two lines and the same totals.
    const after = await journal(api, entry.journalEntryId);
    expect(after.status).toBe("POSTED");
    expect(after.lines).toHaveLength(2);
    expect(after.totalDebitPaise).toBe("50000");
  });

  test("reverses a posted entry with the sides exchanged", async ({
    request,
  }) => {
    // Scenarios 39, 40. The original is preserved; only its status moves.
    const api = await apiAs(request, SUPER_ADMIN);
    const entry = await postBalanced(api, "reversal source");

    const reversed = await api.post(
      `/accounting/journals/${entry.journalEntryId}/reverse`,
      {
        reversalReason: `${SCRATCH_MARKER} posted against the wrong account`,
        expectedVersion: entry.version,
      },
      { "Idempotency-Key": uuid() },
    );

    expect(reversed.status()).toBe(200);
    const reversal = ((await reversed.json()) as { journal: JournalRow })
      .journal;

    expect(reversal.entryType).toBe("REVERSAL");
    expect(reversal.originalEntryNumber).toBe(entry.entryNumber);
    expect(reversal.status).toBe("POSTED");
    expect(reversal.balanced).toBe(true);

    // Each side exchanged against the original.
    const originalBank = entry.lines.find((l) => l.accountCode === "1200")!;
    const reversalBank = reversal.lines.find((l) => l.accountCode === "1200")!;
    expect(originalBank.debitPaise).toBe("50000");
    expect(reversalBank.creditPaise).toBe("50000");
    expect(reversalBank.debitPaise).toBe("0");

    // The original: REVERSED, and its lines untouched.
    const original = await journal(api, entry.journalEntryId);
    expect(original.status).toBe("REVERSED");
    expect(original.lines).toHaveLength(2);
    expect(
      original.lines.find((l) => l.accountCode === "1200")!.debitPaise,
    ).toBe("50000");
  });

  test("refuses a second reversal", async ({ request }) => {
    // Scenario 41. Three layers refuse it; the partial unique index on
    // (org_id, original_journal_entry_id) is the one that holds under
    // concurrency.
    const api = await apiAs(request, SUPER_ADMIN);
    const entry = await postBalanced(api, "double reversal probe");

    const first = await api.post(
      `/accounting/journals/${entry.journalEntryId}/reverse`,
      {
        reversalReason: `${SCRATCH_MARKER} first`,
        expectedVersion: entry.version,
      },
      { "Idempotency-Key": uuid() },
    );
    expect(first.status()).toBe(200);

    const reloaded = await journal(api, entry.journalEntryId);

    const second = await api.post(
      `/accounting/journals/${entry.journalEntryId}/reverse`,
      {
        reversalReason: `${SCRATCH_MARKER} second`,
        expectedVersion: reloaded.version,
      },
      { "Idempotency-Key": uuid() },
    );

    expect(second.status()).toBe(409);
    expect(await second.text()).toContain("already been reversed");
  });

  test("requires an Idempotency-Key to post", async ({ request }) => {
    // Rule 16. A retry without a key cannot be recognised as a retry.
    const api = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const created = await api.post(
      "/accounting/journals",
      draftBody(
        bank.accountId,
        income.accountId,
        "1500",
        "1500",
        "keyless probe",
      ),
    );
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    const posted = await api.post(
      `/accounting/journals/${draft.journalEntryId}/post`,
      { expectedVersion: draft.version },
    );

    expect(posted.status()).toBe(400);
    expect(await posted.text()).toContain("Idempotency-Key");

    await api.delete(`/accounting/journals/${draft.journalEntryId}`);
  });
});

test.describe("Module 14 — idempotency over a real round trip", () => {
  test("returns the existing draft when the same key and body are replayed", async ({
    request,
  }) => {
    // Scenario 25. This is the shape a timed-out client actually produces.
    const api = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const body = draftBody(
      bank.accountId,
      income.accountId,
      "11000",
      "11000",
      "replay probe",
    );

    const first = await api.post("/accounting/journals", body);
    const second = await api.post("/accounting/journals", body);

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);

    const a = ((await first.json()) as { journal: JournalRow }).journal;
    const b = ((await second.json()) as { journal: JournalRow }).journal;

    expect(b.journalEntryId).toBe(a.journalEntryId);
    expect(b.entryNumber).toBe(a.entryNumber);

    await api.delete(`/accounting/journals/${a.journalEntryId}`);
  });

  test("refuses the same key with a materially different body", async ({
    request,
  }) => {
    // Scenario 26.
    const api = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(api, "1200");
    const income = await accountByCode(api, "4100");

    const key = uuid();
    const first = await api.post("/accounting/journals", {
      ...draftBody(
        bank.accountId,
        income.accountId,
        "12000",
        "12000",
        "conflict probe",
      ),
      idempotencyKey: key,
    });
    expect(first.status()).toBe(200);
    const created = ((await first.json()) as { journal: JournalRow }).journal;

    const second = await api.post("/accounting/journals", {
      ...draftBody(
        bank.accountId,
        income.accountId,
        "99000",
        "99000",
        "conflict probe",
      ),
      idempotencyKey: key,
    });

    expect(second.status()).toBe(409);
    expect(await second.text()).toContain("IDEMPOTENCY_KEY_CONFLICT");

    await api.delete(`/accounting/journals/${created.journalEntryId}`);
  });
});

test.describe("Module 14 — the ledger reports", () => {
  test("the trial balance ties out", async ({ request }) => {
    // The assertion the module exists to support. Every posted entry balances
    // individually, so their sum must balance too — across everything the
    // disbursal and collection specs posted as well as this one.
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get("/accounting/ledger/trial-balance");
    expect(response.status()).toBe(200);

    const { trialBalance } = (await response.json()) as {
      trialBalance: {
        balanced: boolean;
        totalDebitPaise: string;
        totalCreditPaise: string;
        rows: unknown[];
      };
    };

    expect(trialBalance.totalDebitPaise).toBe(trialBalance.totalCreditPaise);
    expect(trialBalance.balanced).toBe(true);
    expect(trialBalance.rows.length).toBeGreaterThan(0);
  });

  test("the general ledger carries a running balance forward", async ({
    request,
  }) => {
    // Scenario 32. Computed server-side, so it is right on page 2 as well.
    const api = await apiAs(request, SUPER_ADMIN);
    const control = await accountByCode(api, "1100");

    const response = await api.get(
      `/accounting/ledger?accountId=${control.accountId}&pageSize=3`,
    );
    expect(response.status()).toBe(200);

    const { ledger } = (await response.json()) as {
      ledger: {
        rows: Array<{ runningBalancePaise: string; debitPaise: string }>;
        openingBalancePaise: string;
        total: number;
      };
    };

    expect(ledger.total).toBeGreaterThan(0);
    expect(ledger.rows.length).toBeGreaterThan(1);

    // Each row's balance is the previous one plus its own movement.
    let running = BigInt(ledger.openingBalancePaise);
    for (const row of ledger.rows) {
      running += BigInt(row.debitPaise);
      expect(row.runningBalancePaise).toBe(running.toString());
    }
  });

  test("requires an account for the general ledger", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get("/accounting/ledger");

    expect(response.status()).toBe(400);
  });

  test("reconciliation reports without repairing", async ({ request }) => {
    // Scenarios 58-60. An empty report over the seeded window is the healthy
    // result, and the counts are what distinguish it from an empty window.
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get(
      "/accounting/ledger/reconciliation?fromDate=2020-01-01&toDate=2030-12-31",
    );
    expect(response.status()).toBe(200);

    const { report } = (await response.json()) as {
      report: {
        missingJournals: unknown[];
        duplicateJournals: unknown[];
        unbalancedJournals: unknown[];
        summary: { sourceEventsChecked: number; journalsChecked: number };
      };
    };

    expect(report.summary.journalsChecked).toBeGreaterThan(0);
    // No entry can be unbalanced: the deferred trigger refuses one at COMMIT.
    expect(report.unbalancedJournals).toEqual([]);
  });
});

test.describe("Module 14 — the four withheld Branch Admin grants", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("may author a draft and is refused posting it", async ({ request }) => {
    // Scenarios 44, 49. The split that matters: `journals.create` does not
    // imply `journals.post`, and this is the account that proves it.
    const branch = await apiAs(request, BRANCH_ADMIN);
    const bank = await accountByCode(branch, "1200", "branch");
    const income = await accountByCode(branch, "4100", "branch");

    // Wrapped for the reason `throttled` documents: this spec shares its
    // rate-limit budget with every other spec in the `rbac` group, and a 429
    // here would surface as "expected 200, got 429" on a test about
    // permissions, which names the wrong cause entirely.
    const created = await throttled(() =>
      branch.post(
        "/accounting/journals",
        draftBody(
          bank.accountId,
          income.accountId,
          "20000",
          "20000",
          "branch draft",
        ),
      ),
    );
    expect(created.status()).toBe(200);
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    // Deliberately *not* wrapped: this asserts a 403, and `throttled` only
    // retries a 429. Wrapping would be harmless but would suggest the refusal
    // were rate-related, which it is not.
    const posted = await branch.post(
      `/accounting/journals/${draft.journalEntryId}/post`,
      { expectedVersion: draft.version },
      { "Idempotency-Key": uuid() },
    );
    expect(posted.status()).toBe(403);

    await branch.delete(`/accounting/journals/${draft.journalEntryId}`);
  });

  test("is refused reversing a posted journal", async ({ request }) => {
    // Scenario 50. The Super Admin posts one, then the Branch Admin is refused.
    const admin = await apiAs(request, SUPER_ADMIN);
    const bank = await accountByCode(admin, "1200");
    const income = await accountByCode(admin, "4100");

    const created = await admin.post(
      "/accounting/journals",
      draftBody(
        bank.accountId,
        income.accountId,
        "30000",
        "30000",
        "branch reversal probe",
      ),
    );
    const draft = ((await created.json()) as { journal: JournalRow }).journal;

    const posted = await admin.post(
      `/accounting/journals/${draft.journalEntryId}/post`,
      { expectedVersion: draft.version },
      { "Idempotency-Key": uuid() },
    );
    expect(posted.status()).toBe(200);
    const entry = ((await posted.json()) as { journal: JournalRow }).journal;

    const branch = await apiAs(request, BRANCH_ADMIN);
    const reversed = await branch.post(
      `/accounting/journals/${entry.journalEntryId}/reverse`,
      {
        reversalReason: `${SCRATCH_MARKER} branch attempt`,
        expectedVersion: entry.version,
      },
      { "Idempotency-Key": uuid() },
    );

    expect(reversed.status()).toBe(403);
  });

  test("is refused managing the chart of accounts", async ({ request }) => {
    // Scenario 48. The chart is organization-wide configuration.
    const branch = await apiAs(request, BRANCH_ADMIN);

    const response = await branch.post("/accounting/accounts", {
      accountCode: `ZZB${Date.now().toString().slice(-5)}`,
      accountName: `${SCRATCH_MARKER} branch attempt`,
      accountType: "ASSET",
      normalBalance: "DEBIT",
      status: "ACTIVE",
    });

    expect(response.status()).toBe(403);
  });

  test("is refused running reconciliation", async ({ request }) => {
    // A control function spanning every branch: scoping its findings to one
    // would report every other branch's postings as missing.
    const branch = await apiAs(request, BRANCH_ADMIN);

    const response = await branch.get(
      "/accounting/ledger/reconciliation?fromDate=2026-01-01&toDate=2026-12-31",
    );

    expect(response.status()).toBe(403);
  });

  test("may still read the chart, the journals and the ledger", async ({
    request,
  }) => {
    // The other side of the split: four grants held, four withheld. A Branch
    // Admin who could not read their own ledger could not reconcile a drawer.
    const branch = await apiAs(request, BRANCH_ADMIN);

    for (const path of [
      "/accounting/accounts",
      "/accounting/journals",
      "/accounting/ledger/trial-balance",
    ]) {
      const response = await branch.get(path);
      expect(response.status(), `${path} should be readable`).toBe(200);
    }
  });
});

test.describe("Module 14 — the screens render", () => {
  test("every finance page loads for a Super Admin", async ({ page }) => {
    // A build proves compilation; this proves the pages actually render against
    // the live API with real data.
    const screens: Array<[string, string]> = [
      ["/finance/accounts", "Chart of Accounts"],
      ["/finance/accounts/new", "New Account"],
      ["/finance/journals", "Journal Entries"],
      ["/finance/journals/new", "Journal Lines"],
      ["/finance/ledger", "General Ledger"],
      ["/finance/trial-balance", "Trial Balance"],
      ["/finance/reconciliation", "Reconciliation"],
    ];

    for (const [path, heading] of screens) {
      await page.goto(path);
      await expect(
        page.getByText(heading, { exact: false }).first(),
        `${path} should render`,
      ).toBeVisible();
    }
  });

  test("the trial balance screen shows the seeded accounts and ties out", async ({
    page,
  }) => {
    await page.goto("/finance/trial-balance");

    await expect(page.getByText("Loan Receivable").first()).toBeVisible();
    await expect(
      page.getByText("Totals as of", { exact: false }),
    ).toBeVisible();
    // The imbalance alert must be absent: the ledger ties out.
    await expect(page.getByText("The ledger does not balance")).toHaveCount(0);
  });

  test("the journal builder starts with two lines and a balance hint", async ({
    page,
  }) => {
    await page.goto("/finance/journals/new");

    // Two rows is the floor: a journal needs a debit and a credit, and one line
    // cannot be both.
    await expect(page.getByLabel("Account for line 1")).toBeVisible();
    await expect(page.getByLabel("Account for line 2")).toBeVisible();
    await expect(
      page.getByText("Out of balance", { exact: false }),
    ).toBeVisible();
  });

  test("the sidebar hides Reconciliation from a Branch Admin", async ({
    browser,
  }) => {
    // The withheld grant, visible in the menu. UX only — the route guard and
    // the API both refuse regardless.
    const context = await browser.newContext({
      storageState: STORAGE_STATE.branchAdmin,
    });
    const page = await context.newPage();

    await page.goto("/finance/accounts");

    await expect(
      page.getByRole("link", { name: "Chart of Accounts" }),
    ).toBeVisible();
    // `exact: true`. Accessible-name matching is substring-based by default,
    // and Module 12's "Cash Reconciliation" — which a Branch Admin legitimately
    // holds — contains this word. Without the flag this asserts the absence of
    // a link the Branch Admin is supposed to see, so it fails for a reason that
    // has nothing to do with Module 14's withheld grant.
    await expect(
      page.getByRole("link", { name: "Reconciliation", exact: true }),
    ).toHaveCount(0);

    await context.close();
  });
});
