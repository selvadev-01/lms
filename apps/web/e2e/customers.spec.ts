import { expect, test } from "@playwright/test";

import {
  API_BASE,
  STORAGE_STATE,
  apiAs,
  cookieHeader,
} from "./support/session";

/**
 * Module 04 — Customers & KYC.
 *
 * **Fixture ownership.** This spec owns the seeded customers CUST001–CUST008 and
 * the scratch code range `CUSTZZ*`. No other spec may touch them, and this spec
 * must not mutate any Module 03 user fixture (9000000013–19) beyond signing in
 * as them. CUST008 is the deletable target and lives in BR002 so removing it
 * cannot disturb the BR001 fixtures the rest of the file walks.
 *
 * **Why single-worker.** Like the Module 03 specs, this one mutates shared
 * seeded rows — it approves KYC, converts a customer's type and deletes one. Run
 * in parallel with itself or with those specs, the mutations race and surface as
 * assertion failures far from their cause. `playwright.config.ts` puts this file
 * in the single-worker `rbac` project for exactly that reason.
 *
 * **What is actually being proved.** The refusals, not the happy paths. A
 * Branch Admin who reaches Customer Management and is still denied a delete and
 * a conversion (Scenarios 23, 29); an out-of-branch customer that answers
 * not-found rather than forbidden (Scenario 21); an unverified LOCAL customer
 * that cannot be activated (Scenario 14); an incomplete pack that cannot be
 * approved (Scenario 7); a client-supplied branch that is ignored (Scenario 31).
 */

test.describe.configure({ mode: "serial" });

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";

/**
 * Removes anything left in the scratch range before the suite runs.
 *
 * A test that fails partway leaves its scratch customer behind, and the next run
 * then trips the duplicate-mobile flag instead of testing what it meant to —
 * which reads as a scope bug rather than as leftover state. Cleaning up front
 * rather than only in `afterAll` is the same principle the seed follows: the
 * setup repairs whatever the last run left, so a failure is never inherited.
 *
 * Deletes are throttled at 10/minute, and this suite spends several of its own,
 * so the loop runs only when there is actually something to remove. An
 * unconditional sweep was enough to exhaust the budget before Scenario 37's
 * delete — which then failed as a 429 and read exactly like the delete guard
 * refusing.
 */
test.beforeAll(async ({ request }) => {
  const api = await apiAs(request, SUPER_ADMIN);
  const response = await api.get("/customers");
  if (!response.ok()) return;

  const body = (await response.json()) as {
    customers: Array<{ customerId: string; customerCode: string }>;
  };

  const leftovers = body.customers.filter((customer) =>
    customer.customerCode.startsWith("CUSTZZ"),
  );

  for (const customer of leftovers) {
    await api.delete(`/customers/${customer.customerId}`);
  }
});

/** Resolves a seeded customer's id by its code, for the direct-call assertions. */
async function customerIdByCode(
  api: Awaited<ReturnType<typeof apiAs>>,
  code: string,
): Promise<string> {
  const response = await api.get(`/customers?search=${code}`);
  expect(
    response.ok(),
    `could not list customers (HTTP ${response.status()}). Run: pnpm --filter @lms/api db:seed`,
  ).toBe(true);

  const body = (await response.json()) as {
    customers: Array<{ customerId: string; customerCode: string }>;
  };
  const match = body.customers.find((c) => c.customerCode === code);

  expect(
    match,
    `fixture ${code} is missing. Run: pnpm --filter @lms/api db:seed`,
  ).toBeDefined();

  return match!.customerId;
}

test.describe("Customer search and scope", () => {
  test("Scenario 18 — Super Admin searches by name", async ({ page }) => {
    await page.goto("/customers");
    await expect(
      page.getByRole("heading", { name: "Customer Management" }),
    ).toBeVisible();

    await page.getByLabel("Search customers").fill("Anitha");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(
      page.getByRole("link", { name: "Anitha Raman" }),
    ).toBeVisible();
  });

  test("Scenario 19 — search by customer ID returns the record", async ({
    page,
  }) => {
    await page.goto("/customers?search=CUST003");

    await expect(page.getByRole("link", { name: "Chitra Devi" })).toBeVisible();
  });

  test("Scenario 20 — search by phone prefix", async ({ page }) => {
    await page.goto("/customers?search=9100000005");

    await expect(
      page.getByRole("link", { name: "Eswari Selvam" }),
    ).toBeVisible();
  });

  // Q-CUST-21 — the list is the widest surface in the module.
  test("mobile numbers are masked in the list", async ({ page }) => {
    await page.goto("/customers?search=CUST001");

    await expect(page.getByText("91XXXXXX01")).toBeVisible();
    await expect(page.getByText("9100000001")).toHaveCount(0);
  });

  test("Scenario 22 — the profile shows the unmasked number", async ({
    page,
  }) => {
    await page.goto("/customers?search=CUST001");
    await page.getByRole("link", { name: "Anitha Raman" }).click();

    await expect(page.getByText("9100000001")).toBeVisible();
  });
});

/**
 * Branch confinement (Scenario 21).
 *
 * The refusals here are asserted against the **API** rather than through the
 * browser, and deliberately so: the API is where the rule lives, and a page-level
 * check would prove only that Next.js rendered a 404 page — which it does by
 * collapsing the API's own refusal. Asserting the status *and* the message body
 * is what proves an out-of-scope customer is indistinguishable from an absent
 * one, which a rendered page cannot show.
 *
 * The browser-side half of this is covered by "a BR002 customer is absent from
 * the list", which does run as the Branch Admin.
 */
test.describe("Branch confinement", () => {
  // Every test here runs as the Branch Admin, who is scoped to BR001.
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenario 21 — a BR002 customer is absent from the list", async ({
    page,
  }) => {
    await page.goto("/customers");

    await expect(
      page.getByRole("link", { name: "Anitha Raman" }),
    ).toBeVisible();
    // CUST002 lives in BR002 and must not appear at all.
    await expect(page.getByRole("link", { name: "Bhaskar Nair" })).toHaveCount(
      0,
    );
  });

  test("Scenario 21 — searching for a BR002 customer by name finds nothing", async ({
    page,
  }) => {
    await page.goto("/customers?search=Bhaskar");

    await expect(page.getByText(/No customers match/)).toBeVisible();
  });

  test("Scenario 21 — the API answers 404 for an out-of-branch customer", async ({
    request,
  }) => {
    const superApi = await apiAs(request, SUPER_ADMIN);
    const outOfBranch = await customerIdByCode(superApi, "CUST002");

    const branchApi = await apiAs(request, BRANCH_ADMIN);
    const response = await branchApi.get(`/customers/${outOfBranch}`);

    expect(response.status()).toBe(404);
    // The message must not distinguish out-of-scope from absent.
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("Customer not found");
  });

  test("Scenario 30 — an unknown id answers exactly as an out-of-scope one", async ({
    request,
  }) => {
    const branchApi = await apiAs(request, BRANCH_ADMIN);
    const response = await branchApi.get(
      "/customers/11111111-1111-4111-8111-111111111111",
    );

    expect(response.status()).toBe(404);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("Customer not found");
  });
});

test.describe("Registration", () => {
  test("Scenario 3 — customer type is required", async ({ page }) => {
    await page.goto("/customers/new");

    await page.getByLabel("Full Name").fill("Scratch Customer");
    await page.getByLabel("Mobile Number").fill("9190000001");
    await page.getByLabel("Address Line 1").fill("1 Scratch Street");
    await page.getByRole("button", { name: "Create Customer" }).click();

    await expect(page.getByText("Customer Type is required")).toBeVisible();
  });

  test("Scenario 4 — a LOCAL customer requires name, mobile and address", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.post("/customers", {
      customerType: "LOCAL",
      fullName: "",
      mobile: "9190000002",
      addressLine1: "",
    });

    expect(response.status()).toBe(400);
  });

  // Scenario 31 — the client cannot place a customer in another branch.
  test("Scenario 31 — a submitted branch is ignored for a branch-scoped caller", async ({
    request,
  }) => {
    const superApi = await apiAs(request, SUPER_ADMIN);
    const other = await customerIdByCode(superApi, "CUST002");
    const otherProfile = await superApi.get(`/customers/${other}`);
    const otherBranchId = (
      (await otherProfile.json()) as { customer: { branchId: string } }
    ).customer.branchId;

    const branchApi = await apiAs(request, BRANCH_ADMIN);
    const created = await branchApi.post("/customers", {
      customerType: "LOCAL",
      fullName: "Scope Probe",
      mobile: "9190000003",
      addressLine1: "1 Scope Street",
      customerCode: "CUSTZZ01",
      // The Branch Admin belongs to BR001 and asks for BR002.
      branchId: otherBranchId,
    });

    expect(created.ok()).toBe(true);
    const body = (await created.json()) as {
      branchId: string;
      customerId: string;
    };
    // Their own branch, not the one they asked for.
    expect(body.branchId).not.toBe(otherBranchId);

    await branchApi.delete(`/customers/${body.customerId}`);
  });

  // Scenario 5 — flagged, then overridable.
  test("Scenario 5 — a duplicate mobile is flagged rather than silently created", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.post("/customers", {
      customerType: "LOCAL",
      fullName: "Duplicate Probe",
      // The number CUST001 already carries.
      mobile: "9100000001",
      addressLine1: "1 Duplicate Street",
      customerCode: "CUSTZZ02",
    });

    expect(response.status()).toBe(409);
    const body = (await response.json()) as {
      duplicateOf?: Array<{ customerCode: string }>;
    };
    expect(body.duplicateOf?.some((d) => d.customerCode === "CUST001")).toBe(
      true,
    );
  });

  test("Scenario 5 — the duplicate can be overridden deliberately", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.post("/customers", {
      customerType: "LOCAL",
      fullName: "Duplicate Probe",
      mobile: "9100000001",
      addressLine1: "1 Duplicate Street",
      customerCode: "CUSTZZ03",
      force: true,
    });

    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { customerId: string };

    await api.delete(`/customers/${body.customerId}`);
  });

  // Rules 6 and 12 — neither type may be born active.
  test("a newly created customer is never ACTIVE", async ({ request }) => {
    const api = await apiAs(request, BRANCH_ADMIN);

    const response = await api.post("/customers", {
      customerType: "LOCAL",
      fullName: "Pending Probe",
      mobile: "9190000004",
      addressLine1: "1 Pending Street",
      customerCode: "CUSTZZ04",
    });

    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      customerId: string;
      status: string;
    };
    expect(body.status).toBe("PENDING");

    await api.delete(`/customers/${body.customerId}`);
  });
});

test.describe("LOCAL customers", () => {
  test("Scenario 14 — an unverified LOCAL customer cannot be activated", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    // CUST006 is seeded LOCAL with mobileVerifiedAt null, for exactly this.
    const customerId = await customerIdByCode(api, "CUST006");

    const response = await api.post(`/customers/${customerId}/status`, {
      status: "ACTIVE",
    });

    expect(response.status()).toBe(409);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toMatch(/Mobile number must be verified/);
  });

  test("Scenario 13 — a LOCAL customer has no KYC record to submit", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST005");

    const response = await api.get(`/customers/${customerId}/kyc`);

    // No KYC row exists at all — absence is the representation (Q-CUST-2).
    expect(response.status()).toBe(404);
  });

  test("the profile offers mobile verification for an unverified LOCAL customer", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customerId = await customerIdByCode(api, "CUST006");

    await page.goto(`/customers/${customerId}`);

    await expect(page.getByText("Mobile number not verified")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send Code" })).toBeVisible();
  });

  // A LOCAL customer never gets a KYC tab — not an empty one, none at all.
  test("a LOCAL customer profile has no KYC tab", async ({ page, request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customerId = await customerIdByCode(api, "CUST005");

    await page.goto(`/customers/${customerId}`);

    const tabs = page.getByRole("navigation", { name: "Customer" });

    await expect(tabs.getByRole("button", { name: "Details" })).toBeVisible();
    // Scoped to the tab strip and matched exactly: an unscoped `name: "KYC"` also
    // matches the "Convert to KYC" action button, which would make this pass or
    // fail for reasons unrelated to the tab.
    await expect(
      tabs.getByRole("button", { name: "KYC", exact: true }),
    ).toHaveCount(0);
  });
});

test.describe("KYC review", () => {
  test("Scenario 7 — approval is refused for an incomplete document set", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    // CUST003 is seeded SUBMITTED with no documents at all.
    const customerId = await customerIdByCode(api, "CUST003");

    const kyc = await api.get(`/customers/${customerId}/kyc`);
    const { version } = (await kyc.json()) as { version: string };

    const response = await api.post(`/customers/${customerId}/kyc/review`, {
      decision: "APPROVE",
      expectedVersion: version,
    });

    expect(response.status()).toBe(409);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toMatch(/ID, ADDRESS, PHOTO/);
  });

  test("Scenario 8 — a revision requires a reason", async ({ request }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST003");

    const kyc = await api.get(`/customers/${customerId}/kyc`);
    const { version } = (await kyc.json()) as { version: string };

    const response = await api.post(`/customers/${customerId}/kyc/review`, {
      decision: "REQUEST_REVISION",
      expectedVersion: version,
    });

    expect(response.status()).toBe(400);
  });

  test("Scenario 8 — a seeded revision carries its reason to the screen", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    // CUST004 is seeded REVISION_REQUIRED with a reason on the record.
    const customerId = await customerIdByCode(api, "CUST004");

    await page.goto(`/customers/${customerId}`);
    // Scoped and exact for the same reason as above: "Convert to KYC" would
    // otherwise be an equally good match for this name.
    await page
      .getByRole("navigation", { name: "Customer" })
      .getByRole("button", { name: "KYC", exact: true })
      .click();

    await expect(page.getByText(/Address proof is illegible/)).toBeVisible();
  });

  test("Scenario 40 — a stale version is refused", async ({ request }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST003");

    const response = await api.post(`/customers/${customerId}/kyc/review`, {
      decision: "REQUEST_REVISION",
      reason: "Stale version probe",
      expectedVersion: "2020-01-01T00:00:00.000Z",
    });

    expect(response.status()).toBe(409);
  });

  test("an approved KYC record cannot be reviewed again", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    // CUST001 is seeded APPROVED.
    const customerId = await customerIdByCode(api, "CUST001");

    const kyc = await api.get(`/customers/${customerId}/kyc`);
    const { version } = (await kyc.json()) as { version: string };

    const response = await api.post(`/customers/${customerId}/kyc/review`, {
      decision: "REQUEST_REVISION",
      reason: "Probe",
      expectedVersion: version,
    });

    expect(response.status()).toBe(409);
  });
});

test.describe("Documents", () => {
  test("Scenario 6 — an unsupported file type is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST003");
    // The multipart request is made directly rather than through `apiAs`, whose
    // client only speaks JSON, so the session header is taken from the shared
    // helper instead.
    const cookie = await cookieHeader(request, BRANCH_ADMIN);

    // An HTML document named as a JPEG — the exact case magic-byte sniffing
    // exists to catch (Q-CUST-16).
    const response = await request.post(
      `${API_BASE}/api/v1/customers/${customerId}/documents`,
      {
        headers: { cookie },
        multipart: {
          documentType: "ID",
          file: {
            name: "id-proof.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from("<!doctype html><script>alert(1)</script>"),
          },
        },
      },
    );

    expect(response.status()).toBe(400);
  });

  test("Scenario 32 — a document belonging to another branch is refused", async ({
    request,
  }) => {
    const superApi = await apiAs(request, SUPER_ADMIN);
    const outOfBranch = await customerIdByCode(superApi, "CUST002");

    const branchApi = await apiAs(request, BRANCH_ADMIN);
    const response = await branchApi.get(`/customers/${outOfBranch}/documents`);

    expect(response.status()).toBe(404);
  });
});

test.describe("Branch Admin refusals", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  // Scenario 23 — reaches the screen, denied the action.
  test("Scenario 23 — a Branch Admin cannot delete a customer", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST006");

    const response = await api.delete(`/customers/${customerId}`);

    expect(response.status()).toBe(403);
  });

  // Scenario 29.
  test("Scenario 29 — a Branch Admin cannot convert a customer type", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST007");

    const response = await api.post(`/customers/${customerId}/convert`, {
      expectedVersion: new Date().toISOString(),
    });

    expect(response.status()).toBe(403);
  });

  test("the Branch Admin still reaches Customer Management", async ({
    page,
  }) => {
    await page.goto("/customers");

    // The point of the two refusals above: this caller is not locked out, they
    // are specifically denied two actions.
    await expect(
      page.getByRole("heading", { name: "Customer Management" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Anitha Raman" }),
    ).toBeVisible();
  });

  test("the delete control is not rendered for a Branch Admin", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST006");

    await page.goto(`/customers/${customerId}`);

    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });
});

test.describe("Conversion and deletion", () => {
  // Scenarios 27, 28 — Super Admin only (Q-CUST-6).
  test("Scenario 27 — LOCAL to KYC retains the same record", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    // CUST007 is the seeded conversion target.
    const customerId = await customerIdByCode(api, "CUST007");

    const before = await api.get(`/customers/${customerId}`);
    const { customer } = (await before.json()) as {
      customer: { customerType: string; version: string };
    };
    expect(customer.customerType).toBe("LOCAL");

    const response = await api.post(`/customers/${customerId}/convert`, {
      expectedVersion: customer.version,
    });

    expect(response.ok()).toBe(true);
    const body = (await response.json()) as {
      customerId: string;
      customerType: string;
      status: string;
    };

    // The same record, not a second customer (Scenario 28's guarantee).
    expect(body.customerId).toBe(customerId);
    expect(body.customerType).toBe("KYC");
    // Back to PENDING: they now carry a KYC requirement they have not met.
    expect(body.status).toBe("PENDING");
  });

  test("a KYC customer cannot be converted", async ({ request }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const profile = await api.get(`/customers/${customerId}`);
    const { customer } = (await profile.json()) as {
      customer: { version: string };
    };

    const response = await api.post(`/customers/${customerId}/convert`, {
      expectedVersion: customer.version,
    });

    expect(response.status()).toBe(409);
  });

  // Scenario 37 — the negative case: nothing references CUST008.
  test("Scenario 37 — a customer with no history can be deleted", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customerId = await customerIdByCode(api, "CUST008");

    const response = await api.delete(`/customers/${customerId}`);

    expect(
      response.ok(),
      `delete returned HTTP ${response.status()} — a 429 here means the delete ` +
        `throttle (10/min) was spent by earlier tests, not that the guard refused`,
    ).toBe(true);
    const body = (await response.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Gone, and the seed will restore it for the next run.
    const after = await api.get(`/customers/${customerId}`);
    expect(after.status()).toBe(404);
  });
});

/**
 * Only the separation check remains here. Guarantor identity, consent,
 * lifecycle, KYC and authorization moved to `guarantors.spec.ts` when Module 05
 * built them out; this one stays because it is a claim about *this* module —
 * that adding a guarantor puts nothing in the customer's own document set.
 */
test.describe("Guarantors", () => {
  test("Scenario 26 — guarantor records are separate from customer KYC", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST003");

    const created = await api.post(`/customers/${customerId}/guarantors`, {
      fullName: "Separate Store",
      mobile: "9876543212",
      address: "44 Gandhi Road, Salem",
    });
    expect(created.ok()).toBe(true);
    const { guarantorId } = (await created.json()) as { guarantorId: string };

    // Adding a guarantor must not put anything in the customer's document set,
    // or a guarantor's ID would count toward the customer's required three.
    const documents = await api.get(`/customers/${customerId}/documents`);
    const body = (await documents.json()) as { documents: unknown[] };
    expect(body.documents).toHaveLength(0);

    /**
     * Cleaned up as the Super Admin, not the Branch Admin who created it.
     * Module 05 moved `customers.guarantors.delete` out of `.manage` and
     * deliberately withheld it from BRANCH_ADMIN so Scenario 40 is provable —
     * so a Branch Admin delete here would 403 and silently leave the fixture
     * behind for the next run to trip over.
     */
    const admin = await apiAs(request, SUPER_ADMIN);
    await admin.delete(`/customers/${customerId}/guarantors/${guarantorId}`);
  });
});

test.describe("Profile edit", () => {
  test("Scenario 41 — a stale version is refused", async ({ request }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const response = await api.patch(`/customers/${customerId}`, {
      fullName: "Anitha Raman",
      mobile: "9100000001",
      addressLine1: "12 Gandhi Street",
      expectedVersion: "2020-01-01T00:00:00.000Z",
    });

    expect(response.status()).toBe(409);
  });

  test("Scenario 31 — an orgId in the body is rejected outright", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const profile = await api.get(`/customers/${customerId}`);
    const { customer } = (await profile.json()) as {
      customer: { version: string };
    };

    const response = await api.patch(`/customers/${customerId}`, {
      fullName: "Anitha Raman",
      mobile: "9100000001",
      addressLine1: "12 Gandhi Street",
      expectedVersion: customer.version,
      // forbidNonWhitelisted turns this into a 400 — Scenario 31 enforced by
      // configuration rather than by a hand-written check.
      orgId: "11111111-1111-4111-8111-111111111111",
    });

    expect(response.status()).toBe(400);
  });

  test("an edit is applied and visible on the profile", async ({
    page,
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customerId = await customerIdByCode(api, "CUST004");

    const profile = await api.get(`/customers/${customerId}`);
    const { customer } = (await profile.json()) as {
      customer: { version: string };
    };

    const response = await api.patch(`/customers/${customerId}`, {
      fullName: "Dinesh Kumar",
      mobile: "9100000004",
      addressLine1: "77 Edited Street",
      expectedVersion: customer.version,
    });
    expect(response.ok()).toBe(true);

    await page.goto(`/customers/${customerId}`);
    // The Details tab renders an editable form for a caller who may update, so
    // the saved value is asserted on the input rather than as page text.
    await expect(page.getByLabel("Address Line 1")).toHaveValue(
      "77 Edited Street",
    );
  });
});
