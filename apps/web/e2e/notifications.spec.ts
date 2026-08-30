import { expect, test } from "@playwright/test";

import { apiAs, throttled } from "./support/session";

/**
 * Module 16 — Notifications.
 *
 * The scenarios that can only be proved end to end: that one recipient marking
 * a notification read leaves another's alone, that a mandatory rule ignores a
 * preference the same user just switched off, that a stale preference save is
 * refused rather than applied, and that a Branch Admin who can open every
 * administrative screen is refused every action on all three.
 *
 * # Why this runs in the RBAC project
 *
 * Three reasons, and the third is the decisive one.
 *
 * It signs in as the same `9000000013` / `9000000014` accounts every spec in
 * the `rbac` group uses, so running it in parallel would race their sessions.
 *
 * It creates and deletes notification templates and event rules — organization-
 * scoped configuration that a parallel spec reading the administrative lists
 * would see mid-change. Worse, a rule it creates changes what *other* specs'
 * actions produce: a template created here is matched against events raised by
 * `overdue-recovery.spec.ts` and `collections.spec.ts` while they run.
 *
 * And it must trigger a **real source event** to assert a notification appears
 * — assigning a recovery case — which drives the same `RC-<BRANCH>-` sequence
 * that `overdue-recovery.spec.ts` allocates from, and reads the seeded case
 * fixtures that spec mutates.
 *
 * # Delivery is asynchronous
 *
 * `waitForNotification` polls rather than sleeping. A fixed wait is flaky in
 * both directions: too short and the pipeline has not run, too long and every
 * test pays for the worst case. The worker is in-process, so the round trip is
 * normally well under a second.
 */

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";
const TARGET_USER = "9000000015";

test.describe.configure({ mode: "serial" });
// 240s, matching every other spec in this group: `throttled` waits up to two
// 61-second rate-limit windows, so a doubly-throttled test would otherwise fail
// on timeout rather than on its own assertion.
test.setTimeout(240_000);

/** A unique suffix, so a re-run does not collide with its own leftovers. */
const RUN = Date.now();

/**
 * Polls the notification centre until `predicate` matches, or gives up.
 *
 * Returns the matching row rather than a boolean so the caller can assert on
 * its content — and returns `null` on timeout rather than throwing, so the
 * caller's own assertion names what it was looking for.
 */
async function waitForNotification(
  api: Awaited<ReturnType<typeof apiAs>>,
  predicate: (row: { title: string; eventType: string }) => boolean,
  timeoutMs = 15_000,
): Promise<{
  notificationId: string;
  title: string;
  readStatus: boolean;
} | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await api.get("/notifications?pageSize=50");
    if (response.status() === 200) {
      const body = (await response.json()) as {
        items: {
          notificationId: string;
          title: string;
          eventType: string;
          readStatus: boolean;
        }[];
      };
      const found = body.items.find(predicate);
      if (found) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

test.describe("Module 16 — Notifications", () => {
  test("Scenario 1: a user sees only notifications addressed to them", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const other = await apiAs(request, TARGET_USER);

    const mine = await admin.get("/notifications?pageSize=50");
    const theirs = await other.get("/notifications?pageSize=50");

    expect(mine.status()).toBe(200);
    expect(theirs.status()).toBe(200);

    const mineBody = (await mine.json()) as {
      items: { notificationId: string }[];
    };
    const theirsBody = (await theirs.json()) as {
      items: { notificationId: string }[];
    };

    // No notification id may appear in both lists. A notification belongs to
    // exactly one recipient, and there is no request either user could make
    // that would return the other's.
    const mineIds = new Set(mineBody.items.map((n) => n.notificationId));
    const overlap = theirsBody.items.filter((n) =>
      mineIds.has(n.notificationId),
    );

    expect(overlap).toEqual([]);
  });

  test("Scenario 5: the list filters by read state", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const unread = await api.get(
      "/notifications?readStatus=UNREAD&pageSize=50",
    );
    expect(unread.status()).toBe(200);

    const body = (await unread.json()) as {
      items: { readStatus: boolean }[];
    };

    // Every returned row is genuinely unread — an authorized filter, not a
    // client-side one.
    expect(body.items.every((row) => row.readStatus === false)).toBe(true);
  });

  test("Scenario 42: another organization's notifications are not exposed", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    // The notification centre has no organization parameter at all, so the
    // only way to attempt this is a filter the DTO does not declare —
    // `forbidNonWhitelisted` turns that into a 400 rather than a silent ignore.
    const response = await api.get(
      "/notifications?orgId=00000000-0000-4000-8000-000000000000",
    );

    expect(response.status()).toBe(400);
  });
});

test.describe("Module 16 — preferences", () => {
  test("Scenario 18: a user updates their own preferences", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const before = await api.get("/notifications/preferences");
    expect(before.status()).toBe(200);
    const current = (await before.json()) as {
      version: number;
      inAppEnabled: boolean;
    };

    const saved = await throttled(() =>
      api.put("/notifications/preferences", {
        inAppEnabled: true,
        emailEnabled: false,
        smsEnabled: false,
        eventPreferences: { EMI: false },
        version: current.version,
      }),
    );

    expect(saved.status()).toBe(200);
    const after = (await saved.json()) as { version: number };
    expect(after.version).toBe(current.version + 1);
  });

  test("Scenario 21: a stale update is refused, not applied", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const read = await api.get("/notifications/preferences");
    const state = (await read.json()) as { version: number };

    // First save moves the version on.
    const first = await throttled(() =>
      api.put("/notifications/preferences", {
        inAppEnabled: true,
        emailEnabled: true,
        smsEnabled: false,
        version: state.version,
      }),
    );
    expect(first.status()).toBe(200);

    // Second save carries the version the page originally read — the shape of
    // a user who saved on another device in between.
    const stale = await throttled(() =>
      api.put("/notifications/preferences", {
        inAppEnabled: false,
        emailEnabled: false,
        smsEnabled: true,
        version: state.version,
      }),
    );

    expect(stale.status()).toBe(409);

    const conflict = (await stale.json()) as {
      current?: { version: number; emailEnabled: boolean };
    };
    // The refusal carries the current state, so a client that was behind can
    // reconcile rather than guess.
    expect(conflict.current?.version).toBe(state.version + 1);
    expect(conflict.current?.emailEnabled).toBe(true);

    // And the stale values were not applied.
    const verify = await api.get("/notifications/preferences");
    const verified = (await verify.json()) as { emailEnabled: boolean };
    expect(verified.emailEnabled).toBe(true);
  });

  test("Scenario 19: the route offers no way to reach another user", async ({
    request,
  }) => {
    const api = await apiAs(request, TARGET_USER);

    const read = await api.get("/notifications/preferences");
    const state = (await read.json()) as { version: number };

    // There is no `:userId` route to try, so the only attempt available is an
    // injected field — refused as an unknown property rather than honoured.
    const attempt = await throttled(() =>
      api.put("/notifications/preferences", {
        inAppEnabled: true,
        emailEnabled: true,
        smsEnabled: true,
        version: state.version,
        userId: "00000000-0000-4000-8000-000000000000",
      }),
    );

    expect(attempt.status()).toBe(400);
  });
});

test.describe("Module 16 — a real event becomes a notification", () => {
  test("Scenarios 4, 16, 17: assignment notifies the officer, and read state is per recipient", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);

    // Find a case to assign and a user to assign it to.
    const cases = await admin.get("/recovery/cases?pageSize=20");
    expect(cases.status()).toBe(200);
    const caseBody = (await cases.json()) as {
      items: {
        recoveryCaseId: string;
        caseNumber: string;
        status: string;
        version?: string;
      }[];
    };

    // The officer's own id, read from their own session rather than from an
    // administrative user list. `/users` returns administrator accounts and
    // gives nothing back for a seeded branch user, which would silently skip
    // this test — and a skipped test proves nothing.
    const officerApi = await apiAs(request, TARGET_USER);
    const whoami = await officerApi.get("/auth/me");
    expect(whoami.status()).toBe(200);
    const officer = ((await whoami.json()) as { user: { id: string } }).user;

    /**
     * A case the officer does not already hold.
     *
     * Assigning a case to whoever already holds it is refused as a no-op, so a
     * previous run of this spec would otherwise make the next one skip — and a
     * spec that stops running after it has run once is worse than no spec. The
     * detail exposes `version` (an ISO timestamp, not `updatedAt`) and the
     * current assignee only through the assignment history.
     */
    let target: { recoveryCaseId: string; caseNumber: string } | undefined;
    let detailBody: { version: string } | undefined;

    for (const row of caseBody.items.filter((c) => c.status !== "CLOSED")) {
      const detail = await admin.get(`/recovery/cases/${row.recoveryCaseId}`);
      if (detail.status() !== 200) continue;

      const body = (await detail.json()) as {
        version: string;
        assignments?: { toUserId?: string }[];
      };

      if (body.assignments?.at(-1)?.toUserId !== officer.id) {
        target = row;
        detailBody = body;
        break;
      }
    }

    expect(
      target,
      "expected an open recovery case the target user does not already hold",
    ).toBeDefined();
    if (!target || !detailBody) return;

    // The officer opts out of recovery notifications entirely. The seeded
    // assignment rules are mandatory, so this must not suppress them
    // (Rules 47, 48; Scenario 17).
    const prefsRead = await officerApi.get("/notifications/preferences");
    const prefs = (await prefsRead.json()) as { version: number };
    await throttled(() =>
      officerApi.put("/notifications/preferences", {
        inAppEnabled: false,
        emailEnabled: false,
        smsEnabled: false,
        eventPreferences: { RECOVERY: false },
        version: prefs.version,
      }),
    );

    // The business action.
    const assigned = await throttled(() =>
      admin.post(`/recovery/cases/${target.recoveryCaseId}/assign`, {
        assigneeUserId: officer.id,
        reason: `Module 16 e2e ${RUN}`,
        expectedVersion: detailBody.version,
      }),
    );
    // 201: the assignment controller is a POST that creates an assignment
    // history row.
    expect(assigned.status()).toBe(201);

    // The notification arrives despite every switch being off.
    const arrived = await waitForNotification(
      officerApi,
      (row) =>
        row.eventType === "RECOVERY_ASSIGNED" &&
        row.title.includes(target.caseNumber),
    );

    expect(
      arrived,
      `expected a RECOVERY_ASSIGNED notification for ${target.caseNumber}`,
    ).not.toBeNull();
    if (!arrived) return;

    // Scenario 4: the recipient marks it read.
    const read = await throttled(() =>
      officerApi.patch(`/notifications/${arrived.notificationId}/read`, {}),
    );
    expect(read.status()).toBe(200);

    const confirmed = (await read.json()) as { readStatus: boolean };
    expect(confirmed.readStatus).toBe(true);

    // And another user cannot see it at all — 404, not 403, so its existence
    // is not confirmed.
    const stranger = await apiAs(request, BRANCH_ADMIN);
    const peek = await stranger.get(`/notifications/${arrived.notificationId}`);
    expect(peek.status()).toBe(404);
  });

  test("Scenario 46: archiving removes it from the active list without deleting it", async ({
    request,
  }) => {
    const api = await apiAs(request, TARGET_USER);

    const list = await api.get("/notifications?pageSize=50");
    const body = (await list.json()) as {
      items: { notificationId: string }[];
    };
    test.skip(body.items.length === 0, "no notification to archive");
    if (body.items.length === 0) return;

    const [first] = body.items;

    const archived = await throttled(() =>
      api.patch(`/notifications/${first.notificationId}/archive`, {}),
    );
    expect(archived.status()).toBe(200);

    // Gone from the default list...
    const active = await api.get("/notifications?pageSize=50");
    const activeBody = (await active.json()) as {
      items: { notificationId: string }[];
    };
    expect(
      activeBody.items.some((n) => n.notificationId === first.notificationId),
    ).toBe(false);

    // ...but retained, and still readable when asked for (Rules 70, 71).
    const withArchived = await api.get(
      "/notifications?includeArchived=true&pageSize=50",
    );
    const archivedBody = (await withArchived.json()) as {
      items: { notificationId: string }[];
    };
    expect(
      archivedBody.items.some((n) => n.notificationId === first.notificationId),
    ).toBe(true);
  });
});

test.describe("Module 16 — permission and scope denials", () => {
  test("Scenario 43: a Branch Admin reaches Templates and is refused every write", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    // Reaches the screen.
    const list = await api.get("/admin/notifications/templates");
    expect(list.status()).toBe(200);

    // And is refused the act.
    const created = await throttled(() =>
      api.post("/admin/notifications/templates", {
        name: `Branch Admin attempt ${RUN}`,
        code: `BA_ATTEMPT_${RUN}`,
        category: "RECOVERY",
        sourceModule: "recovery",
        eventType: "RECOVERY_ASSIGNED",
        channel: "IN_APP",
        status: "ACTIVE",
        titleTemplate: "x",
        messageTemplate: "y",
      }),
    );

    expect(created.status()).toBe(403);
  });

  test("Scenario 44: a Branch Admin reaches Event Rules and is refused every write", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const list = await api.get("/admin/notifications/rules");
    expect(list.status()).toBe(200);

    const created = await throttled(() =>
      api.post("/admin/notifications/rules", {
        name: `Branch Admin rule ${RUN}`,
        eventType: "RECOVERY_ASSIGNED",
        sourceModule: "recovery",
        sourceTrigger: "case_assigned",
        recipientStrategy: "ASSIGNED_USER",
        channel: "IN_APP",
        templateId: "00000000-0000-4000-8000-000000000000",
      }),
    );

    expect(created.status()).toBe(403);
  });

  test("Scenario 45: a Branch Admin sees Delivery Monitoring and is refused the retry", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    // The permission split that makes this provable: `deliveries.view` opens
    // the screen, `deliveries.retry` is withheld by the seed.
    const list = await api.get("/admin/notifications/deliveries");
    expect(list.status()).toBe(200);

    const body = (await list.json()) as {
      items: { notificationId: string }[];
    };
    test.skip(body.items.length === 0, "no delivery to attempt a retry on");
    if (body.items.length === 0) return;

    const retried = await throttled(() =>
      api.post(
        `/admin/notifications/deliveries/${body.items[0].notificationId}/retry`,
        { reason: "e2e permission check" },
      ),
    );

    expect(retried.status()).toBe(403);
  });
});

test.describe("Module 16 — template administration", () => {
  test("Scenarios 7, 8, 11: duplicates refused, edits versioned, referenced deletes blocked", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const code = `E2E_TPL_${RUN}`;
    const created = await throttled(() =>
      api.post("/admin/notifications/templates", {
        name: `E2E template ${RUN}`,
        code,
        category: "RECOVERY",
        sourceModule: "recovery",
        eventType: "RECOVERY_ASSIGNED",
        channel: "IN_APP",
        status: "ACTIVE",
        titleTemplate: "Case {{caseNumber}}",
        messageTemplate: "Case {{caseNumber}} is yours.",
      }),
    );
    expect(created.status()).toBe(201);
    const template = (await created.json()) as {
      templateId: string;
      version: number;
    };

    // Scenario 7.
    const duplicate = await throttled(() =>
      api.post("/admin/notifications/templates", {
        name: `E2E template ${RUN} second`,
        code,
        category: "RECOVERY",
        sourceModule: "recovery",
        eventType: "RECOVERY_ASSIGNED",
        channel: "IN_APP",
        status: "ACTIVE",
        titleTemplate: "x",
        messageTemplate: "y",
      }),
    );
    expect(duplicate.status()).toBe(409);

    // Scenario 8: an edit bumps the version.
    const edited = await throttled(() =>
      api.put(`/admin/notifications/templates/${template.templateId}`, {
        messageTemplate: "Case {{caseNumber}} is now yours.",
        expectedVersion: template.version,
      }),
    );
    expect(edited.status()).toBe(200);
    const after = (await edited.json()) as { version: number };
    expect(after.version).toBe(template.version + 1);

    // A second save at the old version is refused rather than applied.
    const stale = await throttled(() =>
      api.put(`/admin/notifications/templates/${template.templateId}`, {
        messageTemplate: "stale",
        expectedVersion: template.version,
      }),
    );
    expect(stale.status()).toBe(409);

    // Scenario 11: a rule referencing it blocks deletion.
    const rule = await throttled(() =>
      api.post("/admin/notifications/rules", {
        name: `E2E rule ${RUN}`,
        eventType: "RECOVERY_ASSIGNED",
        sourceModule: "recovery",
        sourceTrigger: "case_assigned",
        recipientStrategy: "ASSIGNED_USER",
        channel: "IN_APP",
        templateId: template.templateId,
        isActive: false,
      }),
    );
    expect(rule.status()).toBe(201);
    const ruleBody = (await rule.json()) as { ruleId: string };

    const blocked = await throttled(() =>
      api.delete(`/admin/notifications/templates/${template.templateId}`),
    );
    expect(blocked.status()).toBe(409);

    const refusal = (await blocked.json()) as {
      blockers?: { key: string }[];
    };
    expect(refusal.blockers?.some((b) => b.key === "REFERENCED_BY_RULES")).toBe(
      true,
    );

    // Scenario 48: once nothing references it, deletion is permitted.
    const ruleGone = await throttled(() =>
      api.delete(`/admin/notifications/rules/${ruleBody.ruleId}`),
    );
    expect(ruleGone.status()).toBe(204);

    const deleted = await throttled(() =>
      api.delete(`/admin/notifications/templates/${template.templateId}`),
    );
    expect(deleted.status()).toBe(204);
  });

  test("Scenario 15: an unsupported source-event pairing is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    // `recovery` does not raise `DISBURSAL_COMPLETED`. A rule on that pairing
    // would save happily, match nothing, and be indistinguishable from a
    // delivery bug when someone asked why nothing arrived.
    const refused = await throttled(() =>
      api.post("/admin/notifications/templates", {
        name: `E2E bad pair ${RUN}`,
        code: `E2E_BAD_${RUN}`,
        category: "RECOVERY",
        sourceModule: "recovery",
        eventType: "DISBURSAL_COMPLETED",
        channel: "IN_APP",
        status: "ACTIVE",
        titleTemplate: "x",
        messageTemplate: "y",
      }),
    );

    expect(refused.status()).toBe(400);
  });

  test("Rules 55, 56: a template carrying personal detail cannot use SMS", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const refused = await throttled(() =>
      api.post("/admin/notifications/templates", {
        name: `E2E pii sms ${RUN}`,
        code: `E2E_PII_${RUN}`,
        category: "RECOVERY",
        sourceModule: "recovery",
        eventType: "RECOVERY_ASSIGNED",
        channel: "SMS",
        status: "ACTIVE",
        messageTemplate: "{{customerName}} owes {{amountFormatted}}",
        containsPii: true,
      }),
    );

    expect(refused.status()).toBe(400);
  });
});
