import { expect, test } from "@playwright/test";

import { STORAGE_STATE, apiAs } from "./support/session";

/**
 * Module 06 — Loan Products and Schemes.
 *
 * **Fixture ownership.** This spec owns the `PRODZZ*` and `SCHZZ*` scratch
 * ranges and creates everything it needs. It reads the seeded `PROD-*` / `SCH-*`
 * rows to prove the selectability rule but never mutates them — deactivating a
 * seeded scheme would break `loan-applications.spec.ts`, which needs one that
 * works.
 *
 * **Why single-worker.** Product and scheme codes are unique per organization,
 * so two workers creating the same scratch code would collide; and the
 * selectability assertions read the seeded rows the applications spec depends
 * on. `playwright.config.ts` puts this file in the `rbac` project for that
 * reason.
 *
 * **What is actually being proved.**
 *
 * - A Branch Admin who reaches the product list and is refused every write. Not
 *   the usual "withhold one grant so a denial is provable": the source is
 *   explicit that Branch Admin is not a configuration owner, so the whole write
 *   surface is withheld and this spec is what keeps that true.
 * - The three independent halves of selectability — scheme status, product
 *   status, and whether any active duration option exists. A rule that checked
 *   only two would still pass a happy-path test, so each has its own fixture in
 *   the seed and its own assertion here.
 * - A scheme with no active term refusing activation, rather than going live and
 *   failing every application against it.
 */

test.describe.configure({ mode: "serial" });

const SUPER_ADMIN = "9000000013";
const BRANCH_ADMIN = "9000000014";

const SCRATCH_PRODUCT = "PRODZZ-E2E";
const SCRATCH_SCHEME = "SCHZZ-E2E";

type Api = Awaited<ReturnType<typeof apiAs>>;

interface ProductBody {
  loanProductId: string;
  code: string;
  status: string;
  version: string;
}

interface SchemeBody {
  loanSchemeId: string;
  code: string;
  status: string;
  version: string;
  durations: Array<{
    loanSchemeDurationId: string;
    frequency: string;
    durationCount: number;
    status: string;
  }>;
}

/**
 * Returns the scratch row for `code`, creating it only if absent.
 *
 * Products and schemes have no delete endpoint by design — configuration is
 * withdrawn, never erased, because applications reference it. So a re-run cannot
 * start from a clean slate and must instead *reset* whatever the last run left:
 * back to DRAFT, with no active duration options. That is what makes the
 * activation assertions below mean the same thing on every run.
 */
async function scratchProduct(api: Api): Promise<ProductBody> {
  const list = (await (await api.get("/loan-products")).json()) as {
    products: ProductBody[];
  };
  const existing = list.products.find((row) => row.code === SCRATCH_PRODUCT);

  if (!existing) {
    const created = await api.post("/loan-products", {
      code: SCRATCH_PRODUCT,
      name: "E2E scratch product",
      loanType: "BUSINESS",
    });
    expect(created.status(), await created.text()).toBe(201);

    return (await created.json()) as ProductBody;
  }

  if (existing.status === "ACTIVE") {
    const reset = await api.post(
      `/loan-products/${existing.loanProductId}/status`,
      {
        status: "INACTIVE",
        reason: "e2e reset",
        expectedVersion: existing.version,
      },
    );
    expect(reset.status(), await reset.text()).toBe(201);
  }

  return (await (
    await api.get(`/loan-products/${existing.loanProductId}`)
  ).json()) as ProductBody;
}

async function scratchScheme(api: Api, productId: string): Promise<SchemeBody> {
  const list = (await (await api.get("/loan-schemes")).json()) as {
    schemes: Array<{ loanSchemeId: string; code: string }>;
  };
  const existing = list.schemes.find((row) => row.code === SCRATCH_SCHEME);

  if (!existing) {
    const created = await api.post("/loan-schemes", {
      loanProductId: productId,
      code: SCRATCH_SCHEME,
      name: "E2E scratch scheme",
      interestType: "REDUCING",
      interestRateBps: "1500",
    });
    expect(created.status(), await created.text()).toBe(201);

    return (await created.json()) as SchemeBody;
  }

  let scheme = (await (
    await api.get(`/loan-schemes/${existing.loanSchemeId}`)
  ).json()) as SchemeBody;

  if (scheme.status === "ACTIVE") {
    const withdrawn = await api.post(
      `/loan-schemes/${scheme.loanSchemeId}/status`,
      {
        status: "INACTIVE",
        reason: "e2e reset",
        expectedVersion: scheme.version,
      },
    );
    expect(withdrawn.status(), await withdrawn.text()).toBe(201);
  }

  // Strip the terms so the "no active term" assertion has something to prove.
  for (const duration of scheme.durations) {
    await api.delete(
      `/loan-schemes/${scheme.loanSchemeId}/durations/${duration.loanSchemeDurationId}`,
    );
  }

  scheme = (await (
    await api.get(`/loan-schemes/${existing.loanSchemeId}`)
  ).json()) as SchemeBody;

  return scheme;
}

test.describe("configuration is Super Admin's alone", () => {
  test.use({ storageState: STORAGE_STATE.branchAdmin });

  test("a Branch Admin reads the configuration and is refused every write", async ({
    request,
  }) => {
    const branch = await apiAs(request, BRANCH_ADMIN);

    // Reaches both lists: they must, to fill in an application's scheme step.
    expect((await branch.get("/loan-products")).status()).toBe(200);
    expect((await branch.get("/loan-schemes")).status()).toBe(200);

    // And holds no write on either.
    const product = await branch.post("/loan-products", {
      code: "PRODZZ-DENIED",
      name: "Should be refused",
      loanType: "PERSONAL",
    });
    expect(product.status()).toBe(403);

    const scheme = await branch.post("/loan-schemes", {
      loanProductId: "00000000-0000-4000-8000-000000000000",
      code: "SCHZZ-DENIED",
      name: "Should be refused",
      interestType: "FLAT",
      interestRateBps: "1000",
    });
    expect(scheme.status()).toBe(403);
  });
});

test.describe("the selectability rule", () => {
  test.use({ storageState: STORAGE_STATE.superAdmin });

  test("a scheme with no active term cannot be activated", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const product = await scratchProduct(api);
    // Never ACTIVE at this point: a product with no schemes cannot be borrowed
    // against, so it is never born active and a re-run resets it.
    expect(product.status).not.toBe("ACTIVE");

    const scheme = await scratchScheme(api, product.loanProductId);
    expect(scheme.status).not.toBe("ACTIVE");
    expect(scheme.durations.filter((d) => d.status === "ACTIVE")).toHaveLength(
      0,
    );

    // Refused: a scheme nothing can be borrowed over would appear in the
    // wizard's picker and then fail every submission against it.
    const premature = await api.post(
      `/loan-schemes/${scheme.loanSchemeId}/status`,
      {
        status: "ACTIVE",
        expectedVersion: scheme.version,
      },
    );
    expect(premature.status()).toBe(409);

    const withTerm = await api.post(
      `/loan-schemes/${scheme.loanSchemeId}/durations`,
      { frequency: "MONTHLY", durationCount: 6 },
    );
    expect(withTerm.status(), await withTerm.text()).toBe(201);
    const termed = (await withTerm.json()) as SchemeBody;

    const activated = await api.post(
      `/loan-schemes/${scheme.loanSchemeId}/status`,
      { status: "ACTIVE", expectedVersion: termed.version },
    );
    expect(activated.status(), await activated.text()).toBe(201);

    // Still not selectable: its product is a draft. The second half of the rule,
    // and the one a status cascade would have hidden.
    const picker = await api.get("/loan-schemes?selectable=true");
    const { schemes } = (await picker.json()) as {
      schemes: Array<{ code: string }>;
    };
    expect(schemes.map((row) => row.code)).not.toContain(SCRATCH_SCHEME);

    const productNow = (await (
      await api.get(`/loan-products/${product.loanProductId}`)
    ).json()) as ProductBody;
    const live = await api.post(
      `/loan-products/${product.loanProductId}/status`,
      {
        status: "ACTIVE",
        expectedVersion: productNow.version,
      },
    );
    expect(live.status(), await live.text()).toBe(201);

    // All three conditions met, so now it appears.
    const after = await api.get("/loan-schemes?selectable=true");
    const { schemes: offered } = (await after.json()) as {
      schemes: Array<{ code: string }>;
    };
    expect(offered.map((row) => row.code)).toContain(SCRATCH_SCHEME);
  });

  test("the seed's three unselectable schemes are each excluded for their own reason", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const all = (await (await api.get("/loan-schemes")).json()) as {
      schemes: Array<{ code: string; status: string }>;
    };
    const selectable = (await (
      await api.get("/loan-schemes?selectable=true")
    ).json()) as { schemes: Array<{ code: string }> };

    const offered = new Set(selectable.schemes.map((row) => row.code));

    // SCH-GOLD-OLD is INACTIVE; SCH-GOLD-EMPTY is ACTIVE under an ACTIVE product
    // but carries no term. Both must be absent, and for different reasons —
    // which is why the seed carries both rather than one.
    expect(all.schemes.map((row) => row.code)).toContain("SCH-GOLD-OLD");
    expect(offered.has("SCH-GOLD-OLD")).toBe(false);
    expect(all.schemes.map((row) => row.code)).toContain("SCH-GOLD-EMPTY");
    expect(offered.has("SCH-GOLD-EMPTY")).toBe(false);

    // And the working one is still offered, so the filter is not simply empty.
    expect(offered.has("SCH-PERS-RED")).toBe(true);
  });

  test("a stale version is refused on a configuration edit", async ({
    request,
  }) => {
    const api = await apiAs(request, SUPER_ADMIN);

    const list = (await (await api.get("/loan-products")).json()) as {
      products: ProductBody[];
    };
    const target = list.products.find((row) => row.code === SCRATCH_PRODUCT);
    expect(
      target,
      "the scratch product must exist from the earlier test",
    ).toBeTruthy();

    const stale = await api.patch(`/loan-products/${target!.loanProductId}`, {
      name: "Renamed on a stale screen",
      loanType: "BUSINESS",
      expectedVersion: "2020-01-01T00:00:00.000Z",
    });

    expect(stale.status()).toBe(409);
  });
});
