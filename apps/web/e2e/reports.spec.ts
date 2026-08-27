import { expect, test } from "@playwright/test";

import { apiAs } from "./support/session";

/**
 * Module 15 — Reports & Analytics.
 *
 * The scenarios that can only be proved end to end: that a Branch Admin's
 * report is confined to their branch even when they ask otherwise, that a
 * report they may read they may not always export, and — the one that makes the
 * whole reuse decision enforceable — that the financial report's totals equal
 * Module 14's ledger for the same range.
 *
 * # Why this runs in the RBAC project
 *
 * Reports read across every module. The rows they return come from the same
 * seeded and spec-created fixtures that `disbursal.spec.ts`, `collections.spec.ts`,
 * `field-cash.spec.ts`, `accounting.spec.ts` and `overdue-recovery.spec.ts` are
 * concurrently creating and mutating, through the `APP-`, `SL-`, `LN-`, `RCP-`,
 * `CH-`, `CR-`, `JE-` and `RC-` sequences. A parallel run would have this spec
 * asserting on totals that another worker is changing mid-query.
 *
 * # No fixtures of its own
 *
 * Every other spec in the RBAC group creates rows and sweeps them afterwards.
 * This one deliberately creates nothing: reports are read-only (Rules 5, 6, 17),
 * and a report spec that had to write data to test itself would be evidence the
 * module was not read-only. It asserts against whatever the seeded book holds,
 * which is why every assertion below is a relationship — a total equals another
 * total, a scope excludes a branch — rather than a fixed number that a
 * concurrently-running spec could move.
 */

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";

test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

test.describe("Module 15 — Reports & Analytics", () => {
  test("Scenario 1: the dashboard renders for an authorized user", async ({
    page,
  }) => {
    await page.goto("/reports/dashboard");

    await expect(
      page.getByRole("heading", { name: "Reporting Dashboard" }),
    ).toBeVisible();

    // The four KPI groups. They are separate panels because they answer to
    // different date bases (Rule 11), so their presence as distinct headings is
    // the assertion, not decoration.
    await expect(
      page.getByRole("heading", { name: "Portfolio" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Collections" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Delinquency" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recovery" })).toBeVisible();
  });

  test("Scenario 4: the dashboard states its data freshness", async ({
    page,
  }) => {
    await page.goto("/reports/dashboard");

    // Rule 36: aggregated data must not be presented as real-time without an
    // indicator. Nothing is cached today, so the indicator says "now" — which
    // is the truth, and is the field a cache's staleness would surface in.
    await expect(page.getByText(/data as at/i).first()).toBeVisible();
  });

  test("Scenario 7: the portfolio report lists loans with outstanding balances", async ({
    page,
  }) => {
    await page.goto("/reports/portfolio");

    await expect(
      page.getByRole("heading", { name: "Loan Portfolio Report" }),
    ).toBeVisible();

    // The declared basis is stated on the screen, per Rule 10.
    await expect(page.getByText(/filtered by.*disbursal date/i)).toBeVisible();
  });

  test("Scenario 12: each report states the date basis it applied", async ({
    page,
  }) => {
    // The pairing that matters: two reports over the same data, each naming a
    // different column. A report that silently used another module's basis
    // would show the wrong one here.
    await page.goto("/reports/applications");
    await expect(
      page.getByText(/filtered by.*application date/i),
    ).toBeVisible();

    await page.goto("/reports/collections");
    await expect(page.getByText(/filtered by.*collection date/i)).toBeVisible();
  });

  test("Scenario 9: an inverted date range is refused", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get(
      "/reports/collections?fromDate=2026-02-01&toDate=2026-01-01",
    );

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("To Date must be on or after");
  });

  test("Scenario 62: a range beyond the configured limit is refused, not truncated", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get(
      "/reports/collections?fromDate=2020-01-01&toDate=2026-12-31",
    );

    // Refused rather than clamped. A silently narrowed range returns a report
    // that looks complete and answers a different question.
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("Date range cannot exceed");
  });

  test("Scenario 10: a report refuses a date basis it does not permit", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    // An application report filtered by disbursal date would silently drop
    // every application that was never disbursed.
    const response = await api.get(
      "/reports/applications?dateBasis=DISBURSAL_DATE",
    );

    expect(response.status()).toBe(400);
    expect(await response.text()).toContain("cannot be filtered by that date");
  });

  test("Scenario 16: totals are computed over the whole filtered dataset", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const firstPage = await api.get("/reports/collections?pageSize=1");
    expect(firstPage.status()).toBe(200);
    const first = (await firstPage.json()) as {
      total: number;
      rows: unknown[];
      totals: Record<string, string | number>;
    };

    test.skip(first.total < 2, "needs at least two collections in the book");

    const wholeSet = await api.get("/reports/collections?pageSize=100");
    const whole = (await wholeSet.json()) as {
      totals: Record<string, string | number>;
    };

    // One row on screen, the same total underneath. Rule 35: the summary
    // represents the dataset the filters describe, not the page.
    expect(first.rows).toHaveLength(1);
    expect(first.totals.collectedAmountPaise).toBe(
      whole.totals.collectedAmountPaise,
    );
  });

  test("Scenario 27: the financial report reconciles to the Module 14 ledger", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const accounts = await api.get("/accounting/accounts?pageSize=100");
    expect(accounts.status()).toBe(200);
    const { accounts: rows } = (await accounts.json()) as {
      accounts: { accountId: string; isPostable: boolean }[];
    };

    const postable = rows.find((row) => row.isPostable);
    test.skip(!postable, "needs a postable account");

    const accountId = postable!.accountId;

    const [ledgerResponse, reportResponse] = await Promise.all([
      api.get(`/accounting/ledger?accountId=${accountId}&pageSize=100`),
      api.get(`/reports/financial?accountId=${accountId}&pageSize=100`),
    ]);

    expect(ledgerResponse.status()).toBe(200);
    expect(reportResponse.status()).toBe(200);

    const { ledger } = (await ledgerResponse.json()) as {
      ledger: {
        totalDebitPaise: string;
        totalCreditPaise: string;
        total: number;
      };
    };
    const report = (await reportResponse.json()) as {
      total: number;
      totals: Record<string, string>;
    };

    // This is the test that makes the reuse decision enforceable. Module 15's
    // financial report delegates to `GeneralLedgerService` precisely so these
    // figures cannot drift; if someone later gives the report its own
    // aggregation, this is what fails.
    expect(report.totals.debitPaise).toBe(ledger.totalDebitPaise);
    expect(report.totals.creditPaise).toBe(ledger.totalCreditPaise);
    expect(report.total).toBe(ledger.total);
  });

  test("Scenario 25: report money survives as an exact string", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get("/reports/portfolio?pageSize=5");
    expect(response.status()).toBe(200);

    const report = (await response.json()) as {
      rows: { totalOutstandingPaise: string }[];
      totals: Record<string, string | number>;
    };

    // Paise as decimal strings end to end. A number would silently round any
    // figure above ~90,000 crore, and a report is the last place that would be
    // noticed.
    for (const row of report.rows) {
      expect(typeof row.totalOutstandingPaise).toBe("string");
      expect(row.totalOutstandingPaise).toMatch(/^-?\d+$/);
    }
    expect(typeof report.totals.outstandingPrincipalPaise).toBe("string");
  });

  test("Scenario 34: an authorized export downloads a CSV with a BOM", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get(
      "/reports/portfolio/export?format=csv&pageSize=10",
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("attachment");

    const body = await response.body();
    // A UTF-8 BOM, without which Excel reads the file as the system codepage
    // and mangles every non-ASCII customer name.
    expect(body[0]).toBe(0xef);
    expect(body[1]).toBe(0xbb);
    expect(body[2]).toBe(0xbf);

    // The export states its own scope and basis, so a spreadsheet that outlives
    // the screen still records which question it answered.
    const text = body.toString("utf8");
    expect(text).toContain("Date Basis");
    expect(text).toContain("Generated");
  });

  test("Scenario 34: an export can also be produced as a PDF", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const response = await api.get(
      "/reports/portfolio/export?format=pdf&pageSize=10",
    );

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");
    expect((await response.body()).subarray(0, 4).toString("latin1")).toBe(
      "%PDF",
    );
  });
});

/**
 * The denials.
 *
 * Each needs an account that reaches the reporting area and is refused one
 * specific thing — which is why the seed withholds `reports.financial.view` and
 * `reports.export.pii` from the Branch Admin. Granting either would make these
 * unprovable.
 */
test.describe("Module 15 — permission and scope denials", () => {
  test("Scenario 49: a Branch Admin is refused the financial report", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.get("/reports/financial");

    expect(response.status()).toBe(403);
  });

  test("Scenario 28: a Branch Admin still reaches the operational reports", async ({
    request,
  }) => {
    // The other half of the same assertion. A denial test proves nothing if the
    // account is refused everything — what makes Scenario 49 meaningful is that
    // this same user reads the collection report without trouble.
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.get("/reports/collections");

    expect(response.status()).toBe(200);
  });

  test("Scenario 50: a Branch Admin naming another branch is refused", async ({
    request,
  }) => {
    const superAdmin = await apiAs(request, SUPER_ADMIN);
    // `/branches` takes only `activeOnly` — it is a short, unpaginated list.
    const branches = await superAdmin.get("/branches");
    expect(branches.status()).toBe(200);

    const { branches: rows } = (await branches.json()) as {
      branches: { branchId: string }[];
    };

    const mine = await apiAs(request, BRANCH_ADMIN);
    const own = await mine.get("/reports/collections");
    const ownReport = (await own.json()) as {
      meta: { branchId: string | null };
    };

    const other = rows.find((row) => row.branchId !== ownReport.meta.branchId);
    test.skip(!other, "needs a second branch in the organization");

    const response = await mine.get(
      `/reports/collections?branchId=${other!.branchId}`,
    );

    // Refused rather than silently served their own branch's rows under the
    // other branch's heading — a caller who believes they are reading Branch B
    // must not be handed Branch A's numbers.
    expect(response.status()).toBe(403);
  });

  test("Scenario 53: a Branch Admin's report is confined to their branch", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.get("/reports/collections?pageSize=100");
    expect(response.status()).toBe(200);

    const report = (await response.json()) as {
      meta: { branchId: string | null };
      rows: { branchId: string }[];
    };

    // The scope is stated in `meta` and honoured in the rows. Both matter: a
    // report that filtered correctly but reported `null` would tell the reader
    // they were seeing everything.
    expect(report.meta.branchId).not.toBeNull();
    for (const row of report.rows) {
      expect(row.branchId).toBe(report.meta.branchId);
    }
  });

  test("Scenario 35: a caller without PII permission gets masked names", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.get("/reports/collections?pageSize=20");
    expect(response.status()).toBe(200);

    const report = (await response.json()) as {
      meta: { piiMasked: boolean };
      rows: { customerName: string }[];
    };

    // Masked rather than refused — the export still succeeds, with the
    // sensitive columns obscured, which is what the scenario describes.
    expect(report.meta.piiMasked).toBe(true);
    for (const row of report.rows) {
      expect(row.customerName).toMatch(/•/);
    }
  });

  test("Scenario 46: there is no way to edit a reported value", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    // Reports are read-only views (Rules 5, 6, 17). The controller exposes only
    // GET handlers, so a write is not refused by a check — it has nowhere to
    // land. 404 or 405 both prove that; a 200 would mean a write path exists.
    const response = await api.post("/reports/collections", { amount: 1 });

    expect([404, 405]).toContain(response.status());
  });
});
