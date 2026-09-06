/**
 * The starting values for the option lists a business admin maintains.
 *
 * Extracted from `prisma/seed.ts` so the seed and the signup provisioning path
 * cannot drift apart.
 *
 * Every row is seeded `isSystem: true`. These are the values the application
 * shipped with and that business logic reads by code — the KYC completeness
 * check iterates document categories, so deleting `ID` would not fail loudly,
 * it would quietly stop requiring an identity document. The service refuses to
 * delete them; an admin may still relabel them, reorder them, or set them
 * INACTIVE to retire one. Values an admin adds later carry `isSystem: false`
 * and are freely deletable.
 */
export interface MasterDataSpec {
  category: string;
  code: string;
  label: string;
  /** LOAN_TYPE only — see the LOAN_TYPE block below. */
  requiresCollateral?: boolean;
}

export const MASTER_DATA_SPECS: readonly MasterDataSpec[] = [
  // DOCUMENT_TYPE covers the union of the borrower KYC categories and the loan
  // application support categories. They are separate zod enums in the code for
  // good reason — different tables, different permissions — but as an
  // admin-facing list of "kinds of document", one list is what a user expects
  // to see.
  //
  // **This list is labels, not authority.** Which document types are *valid*
  // stays with the `@IsIn` guards in the DTOs, and which are *required* stays
  // with `REQUIRED_KYC_DOCUMENTS` in `kyc.service.ts`, which gates approval.
  // Uploads still read their options from the compiled-in registries; this
  // category exists so an organization can relabel "Identity Proof" to match
  // its own vocabulary without a deploy. Letting an admin add a value here
  // would produce an option every DTO rejects, and letting them remove one
  // would not relax the approval gate — so the rows are all `isSystem` and the
  // service refuses to delete them.
  { category: 'DOCUMENT_TYPE', code: 'ID', label: 'Identity Proof' },
  { category: 'DOCUMENT_TYPE', code: 'ADDRESS', label: 'Address Proof' },
  { category: 'DOCUMENT_TYPE', code: 'PHOTO', label: 'Photograph' },
  { category: 'DOCUMENT_TYPE', code: 'INCOME', label: 'Income Proof' },
  { category: 'DOCUMENT_TYPE', code: 'COLLATERAL', label: 'Collateral' },

  // Replaces the free-text `gender` VarChar(30) on Customer. OTHER and
  // UNDISCLOSED are distinct on purpose: "a third option" and "declined to say"
  // are different answers, and collapsing them loses the distinction.
  { category: 'GENDER', code: 'MALE', label: 'Male' },
  { category: 'GENDER', code: 'FEMALE', label: 'Female' },
  { category: 'GENDER', code: 'OTHER', label: 'Other' },
  { category: 'GENDER', code: 'UNDISCLOSED', label: 'Prefer not to say' },

  // Replaces the free-text `relationship` VarChar(100) on Guarantor.
  { category: 'RELATIONSHIP', code: 'SPOUSE', label: 'Spouse' },
  { category: 'RELATIONSHIP', code: 'PARENT', label: 'Parent' },
  { category: 'RELATIONSHIP', code: 'SIBLING', label: 'Sibling' },
  { category: 'RELATIONSHIP', code: 'CHILD', label: 'Child' },
  { category: 'RELATIONSHIP', code: 'RELATIVE', label: 'Other relative' },
  { category: 'RELATIONSHIP', code: 'FRIEND', label: 'Friend' },
  { category: 'RELATIONSHIP', code: 'COLLEAGUE', label: 'Colleague' },
  {
    category: 'RELATIONSHIP',
    code: 'BUSINESS_PARTNER',
    label: 'Business partner',
  },

  // Replaces the free-text `purpose` on LoanApplication.
  {
    category: 'LOAN_PURPOSE',
    code: 'HOME_IMPROVEMENT',
    label: 'Home improvement',
  },
  { category: 'LOAN_PURPOSE', code: 'EDUCATION', label: 'Education' },
  { category: 'LOAN_PURPOSE', code: 'MEDICAL', label: 'Medical expenses' },
  {
    category: 'LOAN_PURPOSE',
    code: 'BUSINESS_EXPANSION',
    label: 'Business expansion',
  },
  {
    category: 'LOAN_PURPOSE',
    code: 'WORKING_CAPITAL',
    label: 'Working capital',
  },
  {
    category: 'LOAN_PURPOSE',
    code: 'VEHICLE_PURCHASE',
    label: 'Vehicle purchase',
  },
  {
    category: 'LOAN_PURPOSE',
    code: 'DEBT_CONSOLIDATION',
    label: 'Debt consolidation',
  },
  { category: 'LOAN_PURPOSE', code: 'AGRICULTURE', label: 'Agriculture' },
  { category: 'LOAN_PURPOSE', code: 'OTHER', label: 'Other' },

  // Replaces the `LoanType` Postgres enum on LoanProduct.
  //
  // **Unlike DOCUMENT_TYPE above, this list IS authority.** A product's type is
  // whatever code is stored here, and `LoanProductService` refuses a product
  // whose type is not an ACTIVE row — so an admin adding "Tractor" makes a real
  // new type, which is the entire point of moving it out of the enum. An
  // organization that lends against something this codebase never imagined can
  // say so without a deploy.
  //
  // `requiresCollateral` carries the knowledge that used to live in
  // `COLLATERAL_LOAN_TYPES` in the completeness service. It decides whether an
  // application of this type must produce a COLLATERAL document before it can be
  // submitted — a gate, not a label, which is why it lives beside the type
  // rather than in a set the code has to keep in step.
  {
    category: 'LOAN_TYPE',
    code: 'PERSONAL',
    label: 'Personal',
    requiresCollateral: false,
  },
  {
    category: 'LOAN_TYPE',
    code: 'BUSINESS',
    label: 'Business',
    requiresCollateral: false,
  },
  // Secured: a gold loan with no collateral document is the case the gate exists
  // to stop.
  {
    category: 'LOAN_TYPE',
    code: 'GOLD',
    label: 'Gold',
    requiresCollateral: true,
  },
  {
    category: 'LOAN_TYPE',
    code: 'VEHICLE',
    label: 'Vehicle',
    requiresCollateral: true,
  },
];

export interface OrderedMasterDataSpec extends MasterDataSpec {
  displayOrder: number;
}

/**
 * Numbers each category's values in tens, following the spec array's order, so
 * a later insertion has room between two existing values without renumbering
 * the list.
 *
 * Shared by the seed and the provisioning service so both compute the same
 * order — a divergence here would be invisible until two organizations rendered
 * the same dropdown differently.
 */
export function withDisplayOrder(
  specs: readonly MasterDataSpec[] = MASTER_DATA_SPECS,
): OrderedMasterDataSpec[] {
  const orderByCategory: Record<string, number> = {};

  return specs.map((spec) => {
    const next = (orderByCategory[spec.category] ?? 0) + 10;
    orderByCategory[spec.category] = next;
    return { ...spec, displayOrder: next };
  });
}
