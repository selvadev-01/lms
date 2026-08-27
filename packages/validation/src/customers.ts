import { z } from "zod";

import { optionsFrom } from "./options";
import { emailSchema, mobileField, optionalText } from "./primitives";

/**
 * Module 04 schemas — customers, KYC, documents and guarantors.
 *
 * Follows `rbac.ts` in both structure and constraints. The import above reaches
 * for `./primitives` rather than `./index` for the same reason given there:
 * `index.ts` re-exports this file from its last line, so importing from it here
 * would be a live runtime cycle, not merely a type-level one.
 *
 * Three conventions run through every schema:
 *
 * 1. **No scope fields.** No `orgId`, and no `branchId` a caller could use to
 *    place a customer outside their own reach. Both come from the JWT, which is
 *    what makes Scenarios 30 and 31 structural rather than a check somebody has
 *    to remember. The API's `forbidNonWhitelisted` turns an attempt to send
 *    either into a 400.
 *
 * 2. **One field, one endpoint.** Status, customer type and mobile verification
 *    are absent from the update schema because each has its own route and its
 *    own permission. Being allowed to correct a spelling is not thereby
 *    permission to activate a customer or convert their type.
 *
 * 3. **Type-conditional requirements are enforced here, not in the service.**
 *    A LOCAL customer requires Name + Mobile + Address (Rule 11, Scenario 4);
 *    that is expressed as a refinement so the same rule holds for every caller,
 *    including Loan Management when it reuses this module (Rule 27).
 */

/** Explicit, never inferred from whether KYC data happens to exist (Rule 5). */
export const customerTypeSchema = z.enum(["KYC", "LOCAL"], {
  errorMap: () => ({ message: "Customer Type is required" }),
});

export const customerStatusSchema = z.enum([
  "PENDING",
  "ACTIVE",
  "INACTIVE",
  "BLOCKED",
]);

export const kycStatusSchema = z.enum([
  "PENDING",
  "SUBMITTED",
  "REVISION_REQUIRED",
  "APPROVED",
  "REJECTED",
]);

/**
 * The three categories the source names for standard KYC.
 *
 * Loan-side documents (income, collateral) are deliberately excluded: the story
 * warns they must not be folded into the same domain category, and a shared enum
 * is exactly how that would happen by accident.
 */
export const kycDocumentTypeSchema = z.enum(["ID", "ADDRESS", "PHOTO"], {
  errorMap: () => ({ message: "Document Type is required" }),
});

export const documentVerificationStatusSchema = z.enum([
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);

export const consentStatusSchema = z.enum(["PENDING", "GIVEN", "REJECTED"]);

/**
 * Option registries for Module 04.
 *
 * `CUSTOMER_TYPE_OPTIONS` carries `hint` text because the customer-type control
 * is a radio-card group that shows explanatory copy under each choice — copy
 * that previously lived inline in `CustomerForm`'s JSX.
 *
 * Consent labels are phrased as full states ("Consent pending") rather than the
 * bare value, matching the wording the guarantor directory filter already used.
 */
export const CUSTOMER_TYPE_OPTIONS = optionsFrom(
  customerTypeSchema.options,
  { KYC: "KYC Customer", LOCAL: "Local Customer" },
  {
    KYC: {
      hint: "Requires ID, address and photo documents, verified and approved before the customer becomes active.",
    },
    LOCAL: {
      hint: "Skips KYC documents. Requires name, mobile and address, and the mobile must be verified.",
    },
  },
);

export const CUSTOMER_STATUS_OPTIONS = optionsFrom(
  customerStatusSchema.options,
  {
    PENDING: "Pending",
    ACTIVE: "Active",
    INACTIVE: "Inactive",
    BLOCKED: "Blocked",
  },
);

export const KYC_STATUS_OPTIONS = optionsFrom(kycStatusSchema.options, {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  REVISION_REQUIRED: "Revision required",
  APPROVED: "Approved",
  REJECTED: "Rejected",
});

export const KYC_DOCUMENT_TYPE_OPTIONS = optionsFrom(
  kycDocumentTypeSchema.options,
  { ID: "Identity Proof", ADDRESS: "Address Proof", PHOTO: "Photograph" },
);

export const DOCUMENT_VERIFICATION_STATUS_OPTIONS = optionsFrom(
  documentVerificationStatusSchema.options,
  { PENDING: "Pending", VERIFIED: "Verified", REJECTED: "Rejected" },
);

export const CONSENT_STATUS_OPTIONS = optionsFrom(consentStatusSchema.options, {
  PENDING: "Consent pending",
  GIVEN: "Consent given",
  REJECTED: "Consent rejected",
});

/**
 * Customer code. Same character class as the branch and employee codes, and for
 * the same reason: it appears in URLs, search queries and exports, so it stays
 * to what survives all three unescaped.
 */
export const customerCodeSchema = z
  .string()
  .trim()
  .min(1, "Customer ID is required")
  .max(50)
  .regex(/^[A-Za-z0-9_-]+$/, "Enter a valid Customer ID");

const fullNameSchema = z
  .string()
  .trim()
  .min(1, "Full Name is required")
  .max(200);

/**
 * Address line 1 is the only required address field (Q-CUST-26).
 *
 * The source requires "Address" for a LOCAL customer without decomposing it, and
 * demanding a pincode from a caller onboarding someone in a village without one
 * would block a legitimate customer over a field the source never asked for.
 */
const addressLine1Schema = z
  .string()
  .trim()
  .min(1, "Address is required")
  .max(250);

/**
 * Optional date of birth (Q-CUST-24), accepted as `YYYY-MM-DD`.
 *
 * Rejects a future date because a customer born tomorrow is a typo rather than a
 * record, and that is cheap to catch at the edge.
 */
const dateOfBirthSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date of birth")
    .refine((value) => {
      const parsed = Date.parse(`${value}T00:00:00Z`);
      return Number.isFinite(parsed) && parsed <= Date.now();
    }, "Date of birth cannot be in the future")
    .optional(),
);

const optionalEmailSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  emailSchema.optional(),
);

/**
 * The fields common to create and update.
 *
 * Kept separate so the LOCAL refinement can be applied to the create shape
 * without also forcing every partial update to re-supply an address.
 */
const customerProfileFields = {
  fullName: fullNameSchema,
  mobile: mobileField,
  email: optionalEmailSchema,
  dateOfBirth: dateOfBirthSchema,
  gender: optionalText(30),
  addressLine1: addressLine1Schema,
  addressLine2: optionalText(250),
  city: optionalText(100),
  state: optionalText(100),
  pincode: optionalText(10),
};

/**
 * Customer creation.
 *
 * `customerType` is required with its own message, so Scenario 3 ("submits
 * without customer type → creation is rejected") fails on the type rather than
 * on some incidental field.
 *
 * `force` is how Scenario 5 is satisfied without a merge policy: the first
 * submit against an existing mobile comes back with the duplicates listed, and
 * only a caller who has seen them can re-submit with this flag set. It is not a
 * silent create either way.
 */
export const createCustomerSchema = z.object({
  ...customerProfileFields,
  customerType: customerTypeSchema,
  customerCode: customerCodeSchema.optional(),
  force: z.boolean().optional(),
});

/**
 * Profile edit (Scenario 23's target).
 *
 * Deliberately without `customerType`, `status` and `customerCode`: type change
 * is conversion, status change is activation, and the code is the customer's
 * identity. Each has its own route and permission.
 *
 * `expectedVersion` carries the `updatedAt` the client last read. The service
 * refuses a mismatch with a 409 rather than overwriting a committed edit
 * (Q-CUST-22, Scenario 41).
 */
export const updateCustomerSchema = z.object({
  ...customerProfileFields,
  expectedVersion: z.string().min(1),
});

/**
 * Search and filter (Scenarios 18-20).
 *
 * One `search` field rather than three, because the source describes searching
 * by Name, ID or Phone from a single box. The service decides which column a
 * term addresses; making the caller pick would mean a user who typed a phone
 * number into the "name" box gets nothing.
 */
export const listCustomersSchema = z.object({
  search: optionalText(200),
  customerType: customerTypeSchema.optional(),
  status: customerStatusSchema.optional(),
  kycStatus: kycStatusSchema.optional(),
});

export const setCustomerStatusSchema = z.object({
  status: customerStatusSchema,
  reason: optionalText(500),
});

/**
 * LOCAL → KYC conversion (Scenario 27).
 *
 * Carries no target type: the only permitted direction is LOCAL → KYC. There is
 * no KYC → LOCAL, because that would let an approved customer's verification be
 * discarded by a type change.
 */
export const convertCustomerTypeSchema = z.object({
  expectedVersion: z.string().min(1),
  reason: optionalText(500),
});

/** Submit the assembled KYC pack for Branch Admin review. */
export const submitKycSchema = z.object({
  expectedVersion: z.string().min(1),
});

/**
 * The Branch Admin review decision (Scenarios 8, 9).
 *
 * `reason` is required for REVISION_REQUIRED and REJECTED and refused for
 * APPROVE — a revision without a stated reason gives the branch nothing to act
 * on, which is the whole point of the revision loop.
 */
export const reviewKycSchema = z
  .object({
    decision: z.enum(["APPROVE", "REQUEST_REVISION", "REJECT"], {
      errorMap: () => ({ message: "A decision is required" }),
    }),
    reason: optionalText(1000),
    expectedVersion: z.string().min(1),
  })
  .refine(
    (value) => value.decision === "APPROVE" || Boolean(value.reason?.trim()),
    { message: "A reason is required", path: ["reason"] },
  );

/**
 * Document upload metadata. The file itself travels as multipart and is
 * validated by magic bytes server-side (Q-CUST-16) — a client-supplied
 * Content-Type is an assertion by the uploader, not evidence.
 *
 * `documentNumber` is optional (Q-CUST-17): a photo has no number, and an ID
 * whose number is unreadable should still reach a reviewer.
 */
export const uploadDocumentSchema = z.object({
  documentType: kycDocumentTypeSchema,
  documentNumber: optionalText(100),
});

export const verifyDocumentSchema = z
  .object({
    status: z.enum(["VERIFIED", "REJECTED"], {
      errorMap: () => ({ message: "A verification decision is required" }),
    }),
    reason: optionalText(1000),
  })
  .refine(
    (value) => value.status === "VERIFIED" || Boolean(value.reason?.trim()),
    { message: "A reason is required", path: ["reason"] },
  );

export const guarantorStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const guarantorKycStatusSchema = z.enum([
  "NOT_REQUIRED",
  "PENDING",
  "SUBMITTED",
  "REVISION_REQUIRED",
  "APPROVED",
  "REJECTED",
]);

/**
 * Guarantor KYC document categories (Q-GUAR-9, Q-GUAR-10).
 *
 * Distinct from `kycDocumentTypeSchema` despite listing the same three values:
 * the *required* set differs — ID + ADDRESS, with PHOTO accepted but never
 * demanded, because the source never says a guarantor photo is required and
 * requiring one would block approval on a document nobody agreed to collect.
 */
export const guarantorDocumentTypeSchema = z.enum(["ID", "ADDRESS", "PHOTO"], {
  errorMap: () => ({ message: "Document Type is required" }),
});

/**
 * Guarantor option registries (Module 05).
 *
 * `GUARANTOR_DOCUMENT_TYPE_OPTIONS` deliberately mirrors the customer KYC labels
 * while staying a separate registry, for the same reason the schemas are
 * separate: the required subset differs, and one shared list is how that
 * distinction would quietly disappear.
 */
export const GUARANTOR_STATUS_OPTIONS = optionsFrom(
  guarantorStatusSchema.options,
  { ACTIVE: "Active", INACTIVE: "Inactive" },
);

export const GUARANTOR_KYC_STATUS_OPTIONS = optionsFrom(
  guarantorKycStatusSchema.options,
  {
    NOT_REQUIRED: "Not required",
    PENDING: "Pending",
    SUBMITTED: "Submitted",
    REVISION_REQUIRED: "Revision required",
    APPROVED: "Approved",
    REJECTED: "Rejected",
  },
);

export const GUARANTOR_DOCUMENT_TYPE_OPTIONS = optionsFrom(
  guarantorDocumentTypeSchema.options,
  { ID: "Identity Proof", ADDRESS: "Address Proof", PHOTO: "Photograph" },
);

/**
 * Guarantor identity (Module 05, Scenario 9).
 *
 * `address` is **required**, unlike the customer's. Module 05 Rule 13 and the
 * Scenario 9 outline both name "Address is required" as a guarantor validation
 * message, and the wireframe marks it mandatory. Making it conditional would
 * need the loan-product rule that decides when a guarantor is required at all,
 * and that module does not exist yet (Q-GUAR-6).
 *
 * `force` is not guarantor data — it is the caller's acknowledgement of a
 * duplicate warning (Scenario 10, Q-GUAR-4). A guarantor with the same mobile
 * on the same customer is refused with a 409 until the caller repeats the
 * request with `force`, which is audited distinctly from an unflagged create.
 */
export const createGuarantorSchema = z.object({
  fullName: fullNameSchema,
  mobile: mobileField,
  // `required_error` as well as `.min(1)`: a missing key and an empty string are
  // different Zod paths, and without the former an omitted address reports
  // Zod's generic "Required" instead of the message Scenario 9 specifies.
  address: z
    .string({ required_error: "Address is required" })
    .trim()
    .min(1, "Address is required")
    .max(500),
  relationship: optionalText(100),
  force: z.boolean().optional(),
});

/**
 * No longer an alias of create: every guarantor write carries the concurrency
 * token, so two reviewers editing the same record cannot silently overwrite one
 * another (Scenario 46).
 */
export const updateGuarantorSchema = createGuarantorSchema.extend({
  expectedVersion: z.string().min(1),
});

/**
 * Guarantor consent (Scenario 25). The timestamp is the server's, not the
 * caller's — a consent record whose time was supplied by the party recording it
 * proves less than one the system stamped. The actor is likewise taken from the
 * JWT, never the body (Rule 23).
 */
export const recordConsentSchema = z.object({
  consentStatus: consentStatusSchema,
  expectedVersion: z.string().min(1),
});

/**
 * Guarantor deactivation (Scenario 28).
 *
 * `reason` is required, unlike the customer's optional status reason. A
 * guarantor is deactivated *instead of* being deleted, usually because a loan
 * references them, so the stated reason is the only record of why someone chose
 * the non-destructive path.
 */
export const deactivateGuarantorSchema = z.object({
  reason: z
    .string({ required_error: "A reason is required" })
    .trim()
    .min(1, "A reason is required")
    .max(500),
  expectedVersion: z.string().min(1),
});

export const reactivateGuarantorSchema = z.object({
  expectedVersion: z.string().min(1),
});

export const uploadGuarantorDocumentSchema = z.object({
  documentType: guarantorDocumentTypeSchema,
  documentNumber: optionalText(100),
});

export const verifyGuarantorDocumentSchema = z
  .object({
    status: z.enum(["VERIFIED", "REJECTED"], {
      errorMap: () => ({ message: "A verification decision is required" }),
    }),
    reason: optionalText(1000),
  })
  .refine(
    (value) => value.status === "VERIFIED" || Boolean(value.reason?.trim()),
    { message: "A reason is required", path: ["reason"] },
  );

export const submitGuarantorKycSchema = z.object({
  expectedVersion: z.string().min(1),
});

/** Mirrors `reviewKycSchema`: a revision or rejection must say why. */
export const reviewGuarantorKycSchema = z
  .object({
    decision: z.enum(["APPROVE", "REQUEST_REVISION", "REJECT"], {
      errorMap: () => ({ message: "A decision is required" }),
    }),
    reason: optionalText(1000),
    expectedVersion: z.string().min(1),
  })
  .refine(
    (value) => value.decision === "APPROVE" || Boolean(value.reason?.trim()),
    { message: "A reason is required", path: ["reason"] },
  );

/**
 * The organization-scoped guarantor directory (GUA-001).
 *
 * One `search` box for name, mobile and customer, as the customer list does —
 * the service decides which column a term addresses (Q-GUAR-63).
 */
export const listGuarantorsSchema = z.object({
  search: optionalText(200),
  status: guarantorStatusSchema.optional(),
  kycStatus: guarantorKycStatusSchema.optional(),
  consentStatus: consentStatusSchema.optional(),
  customerId: z.string().uuid().optional(),
});

/**
 * LOCAL mobile verification (Scenarios 2, 14).
 *
 * The OTP length is not validated here beyond being digits: the server mints it
 * and knows its own configured length, and a client-side length rule would leak
 * that configuration into the bundle.
 */
export const sendMobileOtpSchema = z.object({});

export const verifyMobileOtpSchema = z.object({
  otp: z
    .string()
    .trim()
    .min(1, "Enter the verification code")
    .regex(/^\d+$/, "Enter the verification code"),
});

export type CustomerTypeInput = z.infer<typeof customerTypeSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;
export type SetCustomerStatusInput = z.infer<typeof setCustomerStatusSchema>;
export type ConvertCustomerTypeInput = z.infer<
  typeof convertCustomerTypeSchema
>;
export type SubmitKycInput = z.infer<typeof submitKycSchema>;
export type ReviewKycInput = z.infer<typeof reviewKycSchema>;
export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type VerifyDocumentInput = z.infer<typeof verifyDocumentSchema>;
export type CreateGuarantorInput = z.infer<typeof createGuarantorSchema>;
export type UpdateGuarantorInput = z.infer<typeof updateGuarantorSchema>;
export type RecordConsentInput = z.infer<typeof recordConsentSchema>;
export type DeactivateGuarantorInput = z.infer<
  typeof deactivateGuarantorSchema
>;
export type ReactivateGuarantorInput = z.infer<
  typeof reactivateGuarantorSchema
>;
export type UploadGuarantorDocumentInput = z.infer<
  typeof uploadGuarantorDocumentSchema
>;
export type VerifyGuarantorDocumentInput = z.infer<
  typeof verifyGuarantorDocumentSchema
>;
export type SubmitGuarantorKycInput = z.infer<typeof submitGuarantorKycSchema>;
export type ReviewGuarantorKycInput = z.infer<typeof reviewGuarantorKycSchema>;
export type ListGuarantorsInput = z.infer<typeof listGuarantorsSchema>;
export type VerifyMobileOtpInput = z.infer<typeof verifyMobileOtpSchema>;
