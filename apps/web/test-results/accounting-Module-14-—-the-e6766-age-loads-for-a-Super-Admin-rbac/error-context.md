# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accounting.spec.ts >> Module 14 — the screens render >> every finance page loads for a Super Admin
- Location: e2e\accounting.spec.ts:969:7

# Error details

```
Error: page.goto: net::ERR_ABORTED at http://localhost:3000/finance/trial-balance
Call log:
  - navigating to "http://localhost:3000/finance/trial-balance", waiting until "load"

```

# Page snapshot

```yaml
- generic [active] [ref=f5e1]:
  - generic [ref=f5e4]:
    - generic [ref=f5e5]:
      - link "Back to dashboard" [ref=f5e7] [cursor=pointer]:
        - /url: /
      - generic [ref=f5e11]:
        - generic [ref=f5e12]:
          - heading "Sign In" [level=1] [ref=f5e13]
          - paragraph [ref=f5e14]: Enter your organization code, mobile number and password to sign in.
        - alert
        - generic [ref=f5e16]:
          - generic [ref=f5e17]:
            - generic [ref=f5e18]: Organization Code *
            - textbox "Organization Code *" [ref=f5e20]:
              - /placeholder: Enter your organization code
          - generic [ref=f5e21]:
            - generic [ref=f5e22]: Mobile Number *
            - textbox "Mobile Number *" [ref=f5e24]:
              - /placeholder: 10-digit mobile number
          - generic [ref=f5e25]:
            - generic [ref=f5e26]: Password *
            - generic [ref=f5e27]:
              - textbox "Password *" [ref=f5e29]:
                - /placeholder: Enter your password
              - button "Show password" [ref=f5e30] [cursor=pointer]
          - link "Forgot password?" [ref=f5e34] [cursor=pointer]:
            - /url: /forgot-password
          - button "Sign in" [ref=f5e36] [cursor=pointer]
    - generic [ref=f5e38]:
      - img "grid" [ref=f5e40]
      - img "grid" [ref=f5e42]
      - generic [ref=f5e43]:
        - link [ref=f5e44] [cursor=pointer]:
          - /url: /
          - img "Logo" [ref=f5e45]
        - paragraph [ref=f5e46]: Sign in to continue to your workspace.
    - button [ref=f5e48] [cursor=pointer]
  - button "Open Next.js Dev Tools" [ref=f5e56] [cursor=pointer]
  - alert [ref=f5e60]
```

# Test source

```ts
  883  | 
  884  |   test("is refused reversing a posted journal", async ({ request }) => {
  885  |     // Scenario 50. The Super Admin posts one, then the Branch Admin is refused.
  886  |     const admin = await apiAs(request, SUPER_ADMIN);
  887  |     const bank = await accountByCode(admin, "1200");
  888  |     const income = await accountByCode(admin, "4100");
  889  | 
  890  |     const created = await admin.post(
  891  |       "/accounting/journals",
  892  |       draftBody(
  893  |         bank.accountId,
  894  |         income.accountId,
  895  |         "30000",
  896  |         "30000",
  897  |         "branch reversal probe",
  898  |       ),
  899  |     );
  900  |     const draft = ((await created.json()) as { journal: JournalRow }).journal;
  901  | 
  902  |     const posted = await admin.post(
  903  |       `/accounting/journals/${draft.journalEntryId}/post`,
  904  |       { expectedVersion: draft.version },
  905  |       { "Idempotency-Key": uuid() },
  906  |     );
  907  |     expect(posted.status()).toBe(200);
  908  |     const entry = ((await posted.json()) as { journal: JournalRow }).journal;
  909  | 
  910  |     const branch = await apiAs(request, BRANCH_ADMIN);
  911  |     const reversed = await branch.post(
  912  |       `/accounting/journals/${entry.journalEntryId}/reverse`,
  913  |       {
  914  |         reversalReason: `${SCRATCH_MARKER} branch attempt`,
  915  |         expectedVersion: entry.version,
  916  |       },
  917  |       { "Idempotency-Key": uuid() },
  918  |     );
  919  | 
  920  |     expect(reversed.status()).toBe(403);
  921  |   });
  922  | 
  923  |   test("is refused managing the chart of accounts", async ({ request }) => {
  924  |     // Scenario 48. The chart is organization-wide configuration.
  925  |     const branch = await apiAs(request, BRANCH_ADMIN);
  926  | 
  927  |     const response = await branch.post("/accounting/accounts", {
  928  |       accountCode: `ZZB${Date.now().toString().slice(-5)}`,
  929  |       accountName: `${SCRATCH_MARKER} branch attempt`,
  930  |       accountType: "ASSET",
  931  |       normalBalance: "DEBIT",
  932  |       status: "ACTIVE",
  933  |     });
  934  | 
  935  |     expect(response.status()).toBe(403);
  936  |   });
  937  | 
  938  |   test("is refused running reconciliation", async ({ request }) => {
  939  |     // A control function spanning every branch: scoping its findings to one
  940  |     // would report every other branch's postings as missing.
  941  |     const branch = await apiAs(request, BRANCH_ADMIN);
  942  | 
  943  |     const response = await branch.get(
  944  |       "/accounting/ledger/reconciliation?fromDate=2026-01-01&toDate=2026-12-31",
  945  |     );
  946  | 
  947  |     expect(response.status()).toBe(403);
  948  |   });
  949  | 
  950  |   test("may still read the chart, the journals and the ledger", async ({
  951  |     request,
  952  |   }) => {
  953  |     // The other side of the split: four grants held, four withheld. A Branch
  954  |     // Admin who could not read their own ledger could not reconcile a drawer.
  955  |     const branch = await apiAs(request, BRANCH_ADMIN);
  956  | 
  957  |     for (const path of [
  958  |       "/accounting/accounts",
  959  |       "/accounting/journals",
  960  |       "/accounting/ledger/trial-balance",
  961  |     ]) {
  962  |       const response = await branch.get(path);
  963  |       expect(response.status(), `${path} should be readable`).toBe(200);
  964  |     }
  965  |   });
  966  | });
  967  | 
  968  | test.describe("Module 14 — the screens render", () => {
  969  |   test("every finance page loads for a Super Admin", async ({ page }) => {
  970  |     // A build proves compilation; this proves the pages actually render against
  971  |     // the live API with real data.
  972  |     const screens: Array<[string, string]> = [
  973  |       ["/finance/accounts", "Chart of Accounts"],
  974  |       ["/finance/accounts/new", "New Account"],
  975  |       ["/finance/journals", "Journal Entries"],
  976  |       ["/finance/journals/new", "Journal Lines"],
  977  |       ["/finance/ledger", "General Ledger"],
  978  |       ["/finance/trial-balance", "Trial Balance"],
  979  |       ["/finance/reconciliation", "Reconciliation"],
  980  |     ];
  981  | 
  982  |     for (const [path, heading] of screens) {
> 983  |       await page.goto(path);
       |                  ^ Error: page.goto: net::ERR_ABORTED at http://localhost:3000/finance/trial-balance
  984  |       await expect(
  985  |         page.getByText(heading, { exact: false }).first(),
  986  |         `${path} should render`,
  987  |       ).toBeVisible();
  988  |     }
  989  |   });
  990  | 
  991  |   test("the trial balance screen shows the seeded accounts and ties out", async ({
  992  |     page,
  993  |   }) => {
  994  |     await page.goto("/finance/trial-balance");
  995  | 
  996  |     await expect(page.getByText("Loan Receivable").first()).toBeVisible();
  997  |     await expect(
  998  |       page.getByText("Totals as of", { exact: false }),
  999  |     ).toBeVisible();
  1000 |     // The imbalance alert must be absent: the ledger ties out.
  1001 |     await expect(page.getByText("The ledger does not balance")).toHaveCount(0);
  1002 |   });
  1003 | 
  1004 |   test("the journal builder starts with two lines and a balance hint", async ({
  1005 |     page,
  1006 |   }) => {
  1007 |     await page.goto("/finance/journals/new");
  1008 | 
  1009 |     // Two rows is the floor: a journal needs a debit and a credit, and one line
  1010 |     // cannot be both.
  1011 |     await expect(page.getByLabel("Account for line 1")).toBeVisible();
  1012 |     await expect(page.getByLabel("Account for line 2")).toBeVisible();
  1013 |     await expect(
  1014 |       page.getByText("Out of balance", { exact: false }),
  1015 |     ).toBeVisible();
  1016 |   });
  1017 | 
  1018 |   test("the sidebar hides Reconciliation from a Branch Admin", async ({
  1019 |     browser,
  1020 |   }) => {
  1021 |     // The withheld grant, visible in the menu. UX only — the route guard and
  1022 |     // the API both refuse regardless.
  1023 |     const context = await browser.newContext({
  1024 |       storageState: STORAGE_STATE.branchAdmin,
  1025 |     });
  1026 |     const page = await context.newPage();
  1027 | 
  1028 |     await page.goto("/finance/accounts");
  1029 | 
  1030 |     await expect(
  1031 |       page.getByRole("link", { name: "Chart of Accounts" }),
  1032 |     ).toBeVisible();
  1033 |     // `exact: true`. Accessible-name matching is substring-based by default,
  1034 |     // and Module 12's "Cash Reconciliation" — which a Branch Admin legitimately
  1035 |     // holds — contains this word. Without the flag this asserts the absence of
  1036 |     // a link the Branch Admin is supposed to see, so it fails for a reason that
  1037 |     // has nothing to do with Module 14's withheld grant.
  1038 |     await expect(
  1039 |       page.getByRole("link", { name: "Reconciliation", exact: true }),
  1040 |     ).toHaveCount(0);
  1041 | 
  1042 |     await context.close();
  1043 |   });
  1044 | });
  1045 | 
```