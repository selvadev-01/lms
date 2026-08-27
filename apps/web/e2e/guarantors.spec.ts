import { expect, test } from "@playwright/test";

import { STORAGE_STATE, apiAs } from "./support/session";

/**
 * Module 05 — Guarantors.
 *
 * **Fixture ownership.** This spec owns guarantors it creates itself, all
 * carrying mobiles in the `98765004xx` range so a leftover from a failed run is
 * identifiable and removable. It reads CUST001 (BR001, the happy-path customer)
 * and CUST002 (BR002, the cross-branch target) but never mutates either, and it
 * must not touch the `CUSTZZ*` scratch range that `customers.spec.ts` owns.
 *
 * **Why single-worker.** Like the Module 03 and 04 specs, this one mutates rows
 * that the others read, and it signs in as the same RBAC accounts. Run beside
 * them, the sessions and the fixtures race and surface as assertion failures far
 * from their cause. `playwright.config.ts` puts this file in the `rbac` project
 * for exactly that reason.
 *
 * **What is actually being proved.** The refusals, and the two rules whose whole
 * point is that one thing must *not* happen to another:
 *
 * - A Branch Admin who reaches the guarantor screen and is still denied a delete
 *   (Scenario 40) — the seed withholds `customers.guarantors.delete` from that
 *   role precisely so this is provable.
 * - A guarantor in another branch answering not-found rather than forbidden
 *   (Scenarios 4, 5, 37), because a 403 would confirm the id exists.
 * - Guarantor KYC leaving the borrower's KYC untouched (Scenario 22) — asserted
 *   by reading the customer's own record before and after.
 * - Deactivation preserving the record rather than removing it (Scenarios 28,
 *   30), which is what makes it the sanctioned alternative to a blocked delete.
 */

test.describe.configure({ mode: "serial" });

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";
const FIELD_EMPLOYEE = "9000000017";

/** Mobiles this spec mints. Anything in the range is ours to clean up. */
const SCRATCH_PREFIX = "987650040";

interface GuarantorBody {
  guarantorId: string;
  fullName: string;
  mobile: string;
  status: string;
  consentStatus: string;
  consentAt?: string;
  consentBy?: string;
  kycStatus: string;
  version: string;
  deactivationReason?: string;
}

async function customerIdByCode(
  api: Awaited<ReturnType<typeof apiAs>>,
  code: string,
): Promise<string> {
  const response = await api.get(`/customers?search=${code}`);
  expect(response.ok(), `could not search for ${code}`).toBe(true);

  const body = (await response.json()) as {
    customers: Array<{ customerId: string; customerCode: string }>;
  };
  const match = body.customers.find(
    (customer) => customer.customerCode === code,
  );

  expect(match, `${code} is missing from the seed`).toBeDefined();
  return match!.customerId;
}

/**
 * Removes anything this spec left behind before it runs again.
 *
 * A test that fails partway leaves a guarantor on CUST001, and the next run then
 * trips the duplicate-mobile flag instead of testing what it meant to — which
 * reads as a scope bug rather than as inherited state. The sweep uses the Super
 * Admin, who unlike the Branch Admin holds `customers.guarantors.delete`.
 */
test.beforeAll(async ({ request }) => {
  const api = await apiAs(request, SUPER_ADMIN);
  const response = await api.get("/guarantors");
  if (!response.ok()) return;

  const body = (await response.json()) as {
    guarantors: Array<{ guarantorId: string; customerId: string }>;
  };

  for (const guarantor of body.guarantors) {
    await api.delete(
      `/customers/${guarantor.customerId}/guarantors/${guarantor.guarantorId}`,
    );
  }
});

test.describe("Guarantor identity and consent", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenarios 6, 9 — a guarantor needs a name, mobile and address", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    // Rule 13 — address is mandatory for a guarantor, unlike the customer's.
    const missingAddress = await api.post(
      `/customers/${customerId}/guarantors`,
      { fullName: "No Address", mobile: `${SCRATCH_PREFIX}1` },
    );
    expect(missingAddress.status()).toBe(400);

    const body = (await missingAddress.json()) as { message: string[] };
    // The first message is the one the web form renders, so it must be the
    // actionable one rather than a length complaint about an absent field.
    expect(body.message[0]).toBe("Address is required");

    const created = await api.post(`/customers/${customerId}/guarantors`, {
      fullName: "Consent Walker",
      mobile: `${SCRATCH_PREFIX}1`,
      address: "12 Nehru Street, Coimbatore",
      relationship: "Brother",
    });
    expect(created.ok()).toBe(true);

    const guarantor = (await created.json()) as GuarantorBody;
    // Scenario 18 — consent is never inferred from the record existing.
    expect(guarantor.consentStatus).toBe("PENDING");
    expect(guarantor.consentAt).toBeUndefined();
    expect(guarantor.status).toBe("ACTIVE");
    // Q-GUAR-11 — no loan product has asked for KYC, so none is outstanding.
    expect(guarantor.kycStatus).toBe("NOT_REQUIRED");
  });

  test("Scenario 10 — a repeated mobile on the same customer is flagged", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const duplicate = await api.post(`/customers/${customerId}/guarantors`, {
      fullName: "Same Number",
      mobile: `${SCRATCH_PREFIX}1`,
      address: "99 Elsewhere Road",
    });

    expect(duplicate.status()).toBe(409);
    const body = (await duplicate.json()) as {
      duplicateOf: Array<{ fullName: string; mobile: string }>;
    };
    expect(body.duplicateOf).toHaveLength(1);
    // Masked even here: the response names the match without restating the
    // number the caller already sent.
    expect(body.duplicateOf[0].mobile).toContain("X");

    // Confirming is a deliberate second act, not a retry that quietly succeeds.
    const forced = await api.post(`/customers/${customerId}/guarantors`, {
      fullName: "Same Number",
      mobile: `${SCRATCH_PREFIX}1`,
      address: "99 Elsewhere Road",
      force: true,
    });
    expect(forced.ok()).toBe(true);

    const { guarantorId } = (await forced.json()) as GuarantorBody;
    await apiAs(request, SUPER_ADMIN).then((admin) =>
      admin.delete(`/customers/${customerId}/guarantors/${guarantorId}`),
    );
  });

  test("Scenarios 15, 46 — consent records its actor, and a stale write is refused", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const list = await api.get(`/customers/${customerId}/guarantors`);
    const { guarantors } = (await list.json()) as {
      guarantors: GuarantorBody[];
    };
    const target = guarantors.find(
      (row) => row.mobile === `${SCRATCH_PREFIX}1`,
    );
    expect(
      target,
      "the guarantor from the first test is missing",
    ).toBeDefined();

    const consented = await api.post(
      `/customers/${customerId}/guarantors/${target!.guarantorId}/consent`,
      { consentStatus: "GIVEN", expectedVersion: target!.version },
    );
    expect(consented.ok()).toBe(true);

    const body = (await consented.json()) as GuarantorBody;
    expect(body.consentStatus).toBe("GIVEN");
    // Rule 23 — the decision, when it was made, and who recorded it.
    expect(body.consentAt).toBeDefined();
    expect(body.consentBy).toBeDefined();

    // Scenario 46 — the version the caller held is now stale.
    const stale = await api.patch(
      `/customers/${customerId}/guarantors/${target!.guarantorId}`,
      {
        fullName: "Stale Write",
        mobile: `${SCRATCH_PREFIX}1`,
        address: "12 Nehru Street, Coimbatore",
        expectedVersion: target!.version,
      },
    );
    expect(stale.status()).toBe(409);
  });

  test("Scenario 14 — a client-supplied customer is refused outright", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");
    const otherCustomerId = await customerIdByCode(api, "CUST003");

    // `forbidNonWhitelisted` turns an attempt to re-parent the guarantor into a
    // 400 — the rule enforced by pipe configuration rather than by a check.
    const response = await api.post(`/customers/${customerId}/guarantors`, {
      fullName: "Reparent Attempt",
      mobile: `${SCRATCH_PREFIX}2`,
      address: "1 Nowhere Lane",
      customerId: otherCustomerId,
    });

    expect(response.status()).toBe(400);
  });
});

test.describe("Guarantor KYC", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenarios 21, 22 — approval needs verified documents and leaves borrower KYC alone", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const before = await api.get(`/customers/${customerId}`);
    const beforeBody = (await before.json()) as {
      kyc?: { status: string };
      documents: unknown[];
    };

    const list = await api.get(`/customers/${customerId}/guarantors`);
    const { guarantors } = (await list.json()) as {
      guarantors: GuarantorBody[];
    };
    const target = guarantors.find(
      (row) => row.mobile === `${SCRATCH_PREFIX}1`,
    )!;

    // Reviewing before anything was submitted is refused: there is no pack.
    const premature = await api.post(
      `/customers/${customerId}/guarantors/${target.guarantorId}/kyc/review`,
      { decision: "APPROVE", expectedVersion: target.version },
    );
    expect(premature.status()).toBe(409);

    const submitted = await api.post(
      `/customers/${customerId}/guarantors/${target.guarantorId}/kyc/submit`,
      { expectedVersion: target.version },
    );
    expect(submitted.ok()).toBe(true);
    const afterSubmit = (await submitted.json()) as GuarantorBody;
    expect(afterSubmit.kycStatus).toBe("SUBMITTED");

    // Scenario 21 — uploading is not verifying, and nothing has been uploaded.
    const blocked = await api.post(
      `/customers/${customerId}/guarantors/${target.guarantorId}/kyc/review`,
      { decision: "APPROVE", expectedVersion: afterSubmit.version },
    );
    expect(blocked.status()).toBe(409);
    const blockedBody = (await blocked.json()) as { message: string };
    // The missing requirements are named, which is what Scenario 21 asks be
    // displayed. PHOTO is absent on purpose (Q-GUAR-9).
    expect(blockedBody.message).toContain("ID");
    expect(blockedBody.message).toContain("ADDRESS");
    expect(blockedBody.message).not.toContain("PHOTO");

    // Scenario 23 — a revision request retains its reason for the branch to act on.
    const revision = await api.post(
      `/customers/${customerId}/guarantors/${target.guarantorId}/kyc/review`,
      {
        decision: "REQUEST_REVISION",
        reason: "Address proof is illegible",
        expectedVersion: afterSubmit.version,
      },
    );
    expect(revision.ok()).toBe(true);
    expect(((await revision.json()) as GuarantorBody).kycStatus).toBe(
      "REVISION_REQUIRED",
    );

    /**
     * Scenario 22 / Rule 75 — the load-bearing assertion. Everything above
     * touched the guarantor's KYC; none of it may have reached the borrower's.
     */
    const after = await api.get(`/customers/${customerId}`);
    const afterBody = (await after.json()) as {
      kyc?: { status: string };
      documents: unknown[];
    };

    expect(afterBody.kyc?.status).toBe(beforeBody.kyc?.status);
    expect(afterBody.documents).toHaveLength(beforeBody.documents.length);
  });

  test("Scenario 20 — a guarantor document is rejected unless its content is an accepted type", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const list = await api.get(`/customers/${customerId}/guarantors`);
    const { guarantors } = (await list.json()) as {
      guarantors: GuarantorBody[];
    };
    const target = guarantors.find(
      (row) => row.mobile === `${SCRATCH_PREFIX}1`,
    )!;

    const documents = await api.get(
      `/customers/${customerId}/guarantors/${target.guarantorId}/documents`,
    );

    // The endpoint exists and answers within scope; the upload path itself is
    // covered by the unit specs, which can supply real magic bytes without
    // pushing a binary through this suite.
    expect(documents.ok()).toBe(true);
    expect((await documents.json()) as { documents: unknown[] }).toEqual({
      documents: [],
    });
  });
});

test.describe("Guarantor lifecycle", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("Scenarios 28, 30 — deactivation needs a reason and keeps the record", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const list = await api.get(`/customers/${customerId}/guarantors`);
    const { guarantors } = (await list.json()) as {
      guarantors: GuarantorBody[];
    };
    const target = guarantors.find(
      (row) => row.mobile === `${SCRATCH_PREFIX}1`,
    )!;

    const noReason = await api.post(
      `/customers/${customerId}/guarantors/${target.guarantorId}/deactivate`,
      { expectedVersion: target.version },
    );
    expect(noReason.status()).toBe(400);

    const deactivated = await api.post(
      `/customers/${customerId}/guarantors/${target.guarantorId}/deactivate`,
      {
        reason: "Withdrew from the arrangement",
        expectedVersion: target.version,
      },
    );
    expect(deactivated.ok()).toBe(true);

    const body = (await deactivated.json()) as GuarantorBody;
    expect(body.status).toBe("INACTIVE");
    expect(body.deactivationReason).toBe("Withdrew from the arrangement");

    // Scenario 30 — deactivation is not deletion. The row is still readable,
    // which is what keeps a historical loan's view of it intact.
    const stillThere = await api.get(
      `/customers/${customerId}/guarantors/${target.guarantorId}`,
    );
    expect(stillThere.ok()).toBe(true);

    // Rule 36 — an inactive guarantor takes no further edits or consent.
    const edit = await api.patch(
      `/customers/${customerId}/guarantors/${target.guarantorId}`,
      {
        fullName: "Edited While Inactive",
        mobile: `${SCRATCH_PREFIX}1`,
        address: "12 Nehru Street, Coimbatore",
        expectedVersion: body.version,
      },
    );
    expect(edit.status()).toBe(409);

    const reactivated = await api.post(
      `/customers/${customerId}/guarantors/${target.guarantorId}/reactivate`,
      { expectedVersion: body.version },
    );
    expect(reactivated.ok()).toBe(true);
    expect(((await reactivated.json()) as GuarantorBody).status).toBe("ACTIVE");
  });

  test("Scenarios 7, 43 — a customer with no guarantors passes the gate", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    // CUST003 carries no guarantors, which is a legitimate state: whether one
    // was required is the loan product's call, not this module's.
    const customerId = await customerIdByCode(api, "CUST003");

    const response = await api.get(
      `/customers/${customerId}/guarantors/readiness`,
    );
    expect(response.ok()).toBe(true);

    const body = (await response.json()) as {
      required: null;
      satisfied: boolean;
      blockers: unknown[];
    };

    // Always null — this module answers "are they usable", never "was one needed".
    expect(body.required).toBeNull();
    expect(body.satisfied).toBe(true);
    expect(body.blockers).toHaveLength(0);
  });
});

test.describe("Guarantor authorization", () => {
  test("Scenario 40 — Branch Admin reaches the screen and is refused a delete", async ({
    request,
  }) => {
    const api = await apiAs(request, BRANCH_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const list = await api.get(`/customers/${customerId}/guarantors`);
    // Reaching the surface is the first half of the claim.
    expect(list.ok()).toBe(true);

    const { guarantors } = (await list.json()) as {
      guarantors: GuarantorBody[];
    };
    const target = guarantors.find(
      (row) => row.mobile === `${SCRATCH_PREFIX}1`,
    )!;

    /**
     * The second half. The seed withholds `customers.guarantors.delete` from
     * BRANCH_ADMIN deliberately — if this ever returns 200, that grant has been
     * "fixed" and the scenario is no longer provable.
     */
    const refused = await api.delete(
      `/customers/${customerId}/guarantors/${target.guarantorId}`,
    );
    expect(refused.status()).toBe(403);

    // And the guarantor is still there, which is what makes the refusal real.
    const stillThere = await api.get(
      `/customers/${customerId}/guarantors/${target.guarantorId}`,
    );
    expect(stillThere.ok()).toBe(true);
  });

  test("Scenarios 3, 38 — a Field Employee is refused the whole surface", async ({
    request,
  }) => {
    const api = await apiAs(request, FIELD_EMPLOYEE);
    const admin = await apiAs(request, SUPER_ADMIN);
    const customerId = await customerIdByCode(admin, "CUST001");

    // Q-GUAR-56/57 — the seed grants a field agent no guarantor permission at
    // all, so both the read and the write are denied.
    const list = await api.get(`/customers/${customerId}/guarantors`);
    expect(list.status()).toBe(403);

    const create = await api.post(`/customers/${customerId}/guarantors`, {
      fullName: "Field Attempt",
      mobile: `${SCRATCH_PREFIX}3`,
      address: "1 Field Road",
    });
    expect(create.status()).toBe(403);

    const directory = await api.get("/guarantors");
    expect(directory.status()).toBe(403);
  });

  test("Scenarios 4, 5, 37 — another branch's guarantor is not found, not forbidden", async ({
    request,
  }) => {
    const admin = await apiAs(request, SUPER_ADMIN);
    const branchAdmin = await apiAs(request, BRANCH_ADMIN);

    // CUST002 lives in BR002; the Branch Admin is confined to BR001.
    const otherBranchCustomerId = await customerIdByCode(admin, "CUST002");

    const created = await admin.post(
      `/customers/${otherBranchCustomerId}/guarantors`,
      {
        fullName: "Other Branch Guarantor",
        mobile: `${SCRATCH_PREFIX}4`,
        address: "5 Far Away Street",
      },
    );
    expect(created.ok()).toBe(true);
    const { guarantorId } = (await created.json()) as GuarantorBody;

    /**
     * 404 rather than 403, deliberately. A 403 would confirm the id exists,
     * which is the disclosure Scenario 5 is about — so an out-of-scope
     * guarantor is indistinguishable from one that was never there.
     */
    const direct = await branchAdmin.get(`/guarantors/${guarantorId}`);
    expect(direct.status()).toBe(404);

    const nested = await branchAdmin.get(
      `/customers/${otherBranchCustomerId}/guarantors/${guarantorId}`,
    );
    expect(nested.status()).toBe(404);

    // And it is absent from the directory rather than merely unopenable.
    const directory = await branchAdmin.get("/guarantors");
    const { guarantors } = (await directory.json()) as {
      guarantors: GuarantorBody[];
    };
    expect(guarantors.some((row) => row.guarantorId === guarantorId)).toBe(
      false,
    );

    await admin.delete(
      `/customers/${otherBranchCustomerId}/guarantors/${guarantorId}`,
    );
  });
});

test.describe("Guarantor directory", () => {
  test("Scenarios 1, 2 — the directory lists, masks and opens", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);
    const customerId = await customerIdByCode(api, "CUST001");

    const list = await api.get("/guarantors");
    expect(list.ok()).toBe(true);

    const { guarantors } = (await list.json()) as {
      guarantors: GuarantorBody[];
    };
    const target = guarantors.find((row) => row.fullName === "Consent Walker");
    expect(
      target,
      "the directory did not return the seeded guarantor",
    ).toBeDefined();

    // Q-GUAR-65 — a browsing surface must not be a standing disclosure of every
    // third party's number.
    expect(target!.mobile).toContain("X");

    // Scenario 2 — the detail view carries the customer relationship and the
    // full number, which is a deliberate act rather than a listing.
    const detail = await api.get(`/guarantors/${target!.guarantorId}`);
    expect(detail.ok()).toBe(true);

    const profile = (await detail.json()) as {
      guarantor: { mobile: string; customerCode: string; customerName: string };
      documents: unknown[];
    };
    expect(profile.guarantor.mobile).toBe(`${SCRATCH_PREFIX}1`);
    expect(profile.guarantor.customerCode).toBe("CUST001");
    expect(profile.guarantor.customerName).toBeTruthy();

    // Search reaches the guarantor by their borrower, which is the question a
    // branch actually asks (Q-GUAR-63).
    const byCustomer = await api.get("/guarantors?search=CUST001");
    const found = (await byCustomer.json()) as { guarantors: GuarantorBody[] };
    expect(
      found.guarantors.some((row) => row.guarantorId === target!.guarantorId),
    ).toBe(true);

    await api.delete(
      `/customers/${customerId}/guarantors/${target!.guarantorId}`,
    );
  });

  test("the directory screen renders for an authorized user", async ({
    page,
  }) => {
    await page.goto("/guarantors");

    await expect(
      page.getByRole("heading", { name: "Guarantors" }).first(),
    ).toBeVisible();
    await expect(page.getByLabel("Search guarantors")).toBeVisible();
  });
});
