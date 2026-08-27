import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/**
 * The Module 03 specs share the seeded RBAC accounts (9000000013–19) and the role
 * fixtures, and each of them mutates those. Run in parallel they race each
 * other's setup and teardown — one file's `afterAll` deletes a scratch account
 * another is still asserting on, which surfaces as a puzzling assertion failure
 * rather than as a fixture problem.
 *
 * `describe.configure({ mode: "serial" })` cannot express this: it orders tests
 * within one file, while Playwright still parallelises the files themselves. A
 * dedicated single-worker project is the mechanism that does.
 */
const RBAC_SPECS = [
  "roles.spec.ts",
  "users.spec.ts",
  "employees.spec.ts",
  // Module 04 joins the same group for the same reason: it approves KYC,
  // converts a customer's type and deletes one, all against shared seeded rows
  // (CUST001–CUST008). It also signs in as the same RBAC accounts, so running it
  // beside those specs would race their sessions as well as their fixtures.
  "customers.spec.ts",
  // Module 05 joins for a third reason on top of those: it reads CUST001 and
  // CUST002, which `customers.spec.ts` mutates, and it deactivates and deletes
  // guarantors hanging off them. Running the two in parallel would have each
  // spec's cleanup sweep removing rows the other was still asserting on.
  "guarantors.spec.ts",
  // Module 07 joins for a fourth reason as well: application numbers come from a
  // per-organization sequence (`APP-000001` upward), so two workers creating
  // applications concurrently contend on that allocation. It also builds every
  // application against CUST001, which `customers.spec.ts` mutates.
  "loan-applications.spec.ts",
  // Module 06 must run beside it rather than in parallel: it asserts on the
  // seeded schemes' selectability, and `loan-applications.spec.ts` depends on at
  // least one of those staying usable. A parallel run would have the config spec
  // reading a scheme mid-change.
  "loan-products.spec.ts",
  // Module 08 inherits every one of those reasons and adds a second sequence of
  // its own: sanction letters are numbered `SL-000001` upward per organization.
  // It also drives applications through to AGREEMENT_SIGNED, a state
  // `loan-applications.spec.ts` asserts nothing reaches, so the two would race
  // each other's expectations as well as their fixtures.
  "approval-workflow.spec.ts",
  // Module 09 inherits all of those and adds two sequences of its own: loans
  // are numbered `LN-000001` upward per organization and journal entries
  // `JE-000001` upward. It also drives applications to DISBURSED, a state both
  // of the specs above assert nothing reaches, and posts to a shared chart of
  // accounts — so a parallel run would race their expectations, their fixtures
  // and two more allocations.
  "disbursal.spec.ts",
  // Module 11 inherits every one of those — it drives applications all the way
  // to DISBURSED itself, through the same `APP-`, `SL-`, `LN-` and `JE-`
  // sequences and against the same CUST001 and shared chart of accounts — and
  // adds a fourth sequence of its own: receipts are numbered
  // `RCP-<BRANCH>-000001` upward per branch. Two workers collecting in the same
  // branch would contend on that allocation, and the loser's whole posting
  // rolls back, which would surface as an intermittent failure rather than as
  // the contention it is.
  "collections.spec.ts",
  // Module 14 joins for two of the same reasons and one of its own. It
  // allocates from the same per-organization `JE-` sequence that disbursal and
  // collection allocate from, and it reads the shared chart of accounts both
  // post against — so a parallel run would race that allocation and the loser's
  // whole transaction would roll back.
  //
  // Its own reason: it creates and deactivates accounts. It is careful to touch
  // only accounts it created — never the six seeded codes the other two specs
  // post through — but a concurrent run would still have it reading the chart
  // mid-change, and a deactivated account is exactly what makes a posting fail.
  "accounting.spec.ts",
  // Module 12 inherits every reason `collections.spec.ts` gives — it drives
  // applications to DISBURSED through the same `APP-`, `SL-`, `LN-`, `JE-` and
  // `RCP-` sequences, against the same CUST001 and the same shared chart of
  // accounts — and adds two sequences of its own, `CH-` and `CR-`, both
  // allocated per branch.
  //
  // Its own reason is stronger than any of those, and is why this file cannot
  // simply be made parallel later: **its concurrency tests need sole control of
  // one agent's cash pool.** Scenario 49 fires two receives at one handover and
  // asserts exactly one succeeds. A parallel worker collecting as the same
  // seeded Field Employee would change the derived balance between the submit
  // and the race, and the test would fail for a reason that has nothing to do
  // with the double-spend it exists to catch.
  "field-cash.spec.ts",
  // Module 13 inherits most of `collections.spec.ts`'s reasons — it drives
  // applications to DISBURSED through the same `APP-`, `SL-`, `LN-` and `JE-`
  // sequences, against the same CUST001 and the same shared chart of accounts —
  // and adds one sequence of its own: recovery cases are numbered
  // `RC-<BRANCH>-000001` per branch, so two workers opening cases in one branch
  // contend on that allocation and the loser's whole transaction rolls back.
  //
  // Its own reason: it **backdates disbursements** to manufacture genuinely
  // overdue loans. A parallel spec asserting on the overdue book would see this
  // one's fixtures appear in its results, and the "is this loan listed" checks
  // would pass or fail depending on timing rather than on behaviour.
  "overdue-recovery.spec.ts",
  // Module 15 inherits every reason above at once, which is the point: a report
  // reads across all of them. Its assertions are totals over the same rows that
  // `disbursal`, `collections`, `field-cash`, `accounting` and
  // `overdue-recovery` are concurrently creating and mutating, through the
  // `APP-`, `SL-`, `LN-`, `RCP-`, `CH-`, `CR-`, `JE-` and `RC-` sequences. It
  // creates no fixtures of its own — reports are read-only — so it cannot race
  // anything by writing, but a parallel run would have it asserting on figures
  // another worker was moving mid-query.
  "reports.spec.ts",
  // Module 16 joins for three reasons, the third of which is decisive.
  //
  // It signs in as the same 9000000013 / 9000000014 / 9000000015 accounts every
  // spec above uses, so a parallel run would race their sessions.
  //
  // It creates and deletes notification templates and event rules —
  // organization-scoped configuration a parallel spec reading the
  // administrative lists would see mid-change.
  //
  // And its own reason: a rule it creates changes what *other* specs' actions
  // produce. Notification rules match on event type across the whole
  // organization, so a template and rule created here are matched against the
  // events `overdue-recovery.spec.ts` and `collections.spec.ts` raise while they
  // run. It also assigns a real recovery case to prove an event becomes a
  // notification, which allocates from the same `RC-<BRANCH>-` sequence and
  // reads the case fixtures that spec mutates.
  "notifications.spec.ts",
  // Module 17 joins for the session reason above, which is on its own decisive.
  //
  // These three sign in as 9000000013 / 9000000014 from the shared storage
  // states, so running them in the parallel `chromium` project had them racing
  // the specs above — `users.spec.ts` deactivates an account to prove a
  // deactivation ends a live session immediately, and that revocation landed
  // mid-run here. The symptom was a redirect to /signin in whichever spec was
  // unlucky, which reads as an authorization bug in the module under test
  // rather than as another spec doing exactly what it says it does.
  //
  // `config-transfer.spec.ts` has a second reason: an import writes
  // organization-scoped settings, which every other spec's screens read.
  "settings-governance.smoke.spec.ts",
  "settings-governance.nav.spec.ts",
  "config-transfer.spec.ts",
  // Not for a shared account — it owns 9000000008 exclusively and never changes
  // its password. It joins because of what it DOES: it signs in from several
  // simultaneous browser contexts and revokes them, including "sign out
  // everywhere else". Run in parallel, its own revocations and `users.spec.ts`'s
  // deactivation raced each other, and the loser was redirected to /signin
  // mid-test. It passes in isolation, which is the signature of this race
  // rather than of a broken assertion.
  //
  // Module 18 joins for the same reason `reports.spec.ts` does, one step
  // further out. It writes nothing — the dashboard is a read and navigation
  // layer — but every figure it asserts on is a live aggregate over rows that
  // `disbursal`, `collections`, `field-cash`, `accounting` and
  // `overdue-recovery` are concurrently creating and moving. It also signs in
  // as the shared RBAC accounts to prove that a Branch Admin cannot reach
  // another branch, so a parallel run would race their sessions as well as
  // their fixtures.
  "dashboard.spec.ts",
];

/**
 * Specs that revoke sessions AND sign in for themselves.
 *
 * They cannot join `RBAC_SPECS`: that project supplies a Super Admin
 * `storageState`, and each of these has a test asserting what an
 * *unauthenticated* visitor sees, which an ambient session makes unprovable.
 * Nor can they stay in the parallel `chromium` project, because their
 * revocations land on whatever else is mid-request — `sessions.spec.ts` runs
 * "sign out everywhere else", and `gps-check-in.spec.ts` says in its own header
 * that it "creates check-in rows and revokes sessions".
 *
 * So they get their own serialized project with no ambient state: authenticated
 * only where they sign in, and never running beside anything they can revoke.
 */
const UNAUTHENTICATED_SERIAL_SPECS = [
  "sessions.spec.ts",
  "gps-check-in.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    /**
     * Signs in once per role and saves the browser state. Every RBAC spec starts
     * from one of those files, so no test spends time on the login form and the
     * suite makes three sign-ins rather than forty-three — which matters against
     * a per-IP rate limit.
     */
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [
        ...RBAC_SPECS,
        ...UNAUTHENTICATED_SERIAL_SPECS,
        "auth.setup.ts",
      ],
    },
    {
      // No `storageState` and no `dependencies` on setup: these specs sign in
      // for themselves, and one test in each asserts what an unauthenticated
      // visitor sees. See UNAUTHENTICATED_SERIAL_SPECS above.
      name: "unauthenticated-serial",
      use: { ...devices["Desktop Chrome"] },
      testMatch: UNAUTHENTICATED_SERIAL_SPECS,
      // Runs AFTER `rbac` rather than beside it. Without the dependency the two
      // serialized projects still execute concurrently with each other, and the
      // sign-ins these specs make compete with the ones `rbac` is making — which
      // put failures back into both groups. Ordering them costs wall-clock and
      // buys determinism.
      dependencies: ["rbac"],
      fullyParallel: false,
      workers: 1,
    },
    {
      name: "rbac",
      use: {
        ...devices["Desktop Chrome"],
        // The Super Admin state is the default; the specs override it per
        // describe block where they need a Branch Admin.
        storageState: "e2e/.auth/super-admin.json",
      },
      testMatch: RBAC_SPECS,
      dependencies: ["setup"],
      // One worker for the whole group, so the three specs cannot overlap.
      fullyParallel: false,
      workers: 1,
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
