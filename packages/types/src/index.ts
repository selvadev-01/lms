/**
 * Shared domain types for the Loan Management System.
 *
 * Consumed by both apps/web and apps/api, so nothing here may import from a
 * framework. Keep it plain TypeScript.
 */

export type ID = string;

export type Role =
  "SUPER_ADMIN" | "BRANCH_ADMIN" | "FIELD_EMPLOYEE" | "CUSTOMER";

/**
 * The lifecycle of a `Loan` — the row that exists only once money has been
 * committed to move, which is Module 09's to create.
 *
 * Mirrors the Prisma `LoanStatus` enum exactly. It previously did not: this
 * type was written speculatively before any module wrote a loan and carried
 * `SUBMITTED` and `DEFAULTED`, neither of which exists in the database, while
 * missing the six states that do. Nothing consumed it, so the drift was
 * invisible until Module 09 became the first module to write the table.
 *
 * Note that a loan's lifecycle is not an application's. An application ends at
 * AGREEMENT_SIGNED; a loan begins there. `ApplicationStatus` is the other one.
 */
export type LoanStatus =
  | "DRAFT"
  | "APPROVED"
  | "SANCTIONED"
  | "AGREEMENT_PENDING"
  | "AGREEMENT_SIGNED"
  | "DISBURSEMENT_PENDING"
  | "ACTIVE"
  | "OVERDUE"
  /** Module 13. Reached by an authorized action, never automatically (Rule 29). */
  | "NPA"
  | "LEGAL_ESCALATION"
  | "RESTRUCTURED"
  | "CLOSURE_PENDING"
  | "CLOSED"
  /** Module 13. Guarded against; no module currently produces it. */
  | "FORECLOSED"
  | "WRITTEN_OFF"
  | "REJECTED";

/** Mirrors the Prisma `EmiStatus` enum. Corrected alongside `LoanStatus`. */
export type EmiStatus =
  | "PENDING"
  | "DUE"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "WAIVED"
  | "CANCELLED";

/** Mirrors the Prisma `PaymentMode` enum. */
export type PaymentMode = "CASH" | "UPI" | "BANK_TRANSFER";

/** Mirrors the Prisma `PaymentType` enum. Derived server-side after allocation. */
export type PaymentType = "FULL_PAYMENT" | "PARTIAL_PAYMENT" | "PENALTY_ONLY";

/**
 * Mirrors the Prisma `CollectionStatus` enum.
 *
 * Only `POSTED` and `REVERSED` are authoritative money. `FAILED` is written by
 * the outer catch after a posting transaction rolled back, never committed by
 * the posting itself.
 */
export type CollectionStatus =
  "CREATED" | "SYNCED" | "POSTED" | "REVERSED" | "FAILED";

/** Mirrors the Prisma `CollectionComponent` enum. */
export type CollectionComponent = "PRINCIPAL" | "INTEREST" | "PENALTY" | "FEE";

/** Mirrors the Prisma `PaymentVerificationStatus` enum. */
export type PaymentVerificationStatus =
  "PENDING_VERIFICATION" | "CONFIRMED" | "REJECTED" | "RECONCILED";

/** Mirrors the Prisma `DisbursementStatus` enum. */
export type DisbursementStatus =
  "SCHEDULED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

/**
 * Session lifecycle state, derived from the `user_sessions` timestamps rather
 * than stored — see SESSION_STATE in @lms/constants.
 */
export type SessionState = "ACTIVE" | "EXPIRED" | "REVOKED" | "LOGGED_OUT";

/**
 * One row of the Active Sessions screen.
 *
 * Deliberately has no field for the refresh token or its hash: the session
 * secret must never cross the wire, and its absence from this type is what
 * makes that a compile-time guarantee rather than a convention.
 */
export interface SessionSummary {
  sessionId: ID;
  state: SessionState;
  /** True for the session making the request — it is signed out, not revoked. */
  isCurrent: boolean;
  /** ISO-8601. Serialized as strings because these cross an HTTP boundary. */
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** Present only where policy permits recording it; null otherwise. */
  ipAddress: string | null;
  userAgent: string | null;
  /** Branch scope captured at sign-in, not the user's current branch. */
  branchId: ID | null;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
}

/** Returned by every revoke path, so the caller can report what it ended. */
export interface RevokeSessionsResponse {
  /**
   * Sessions actually terminated by this call. Zero is a success, not an
   * error: revoking an already-terminated session is idempotent.
   */
  revokedCount: number;
  /** True when the caller ended its own session and must be signed out. */
  currentSessionRevoked: boolean;
}

/** See GPS_* const maps in @lms/constants for the authoritative value lists. */
export type GpsVerificationStatus =
  "PENDING" | "VERIFIED" | "FAILED" | "EXPIRED" | "CANCELLED";

export type GpsPermissionStatus =
  "GRANTED" | "DENIED" | "UNAVAILABLE" | "UNKNOWN";

export type GpsNetworkStatus = "ONLINE" | "OFFLINE";

export type GpsFailureReason =
  | "PERMISSION_DENIED"
  | "POSITION_UNAVAILABLE"
  | "TIMEOUT"
  | "ACCURACY_REJECTED"
  | "STALE_LOCATION"
  | "INVALID_COORDINATES"
  | "PROVIDER_ERROR"
  | "NETWORK_LOST"
  | "PERSISTENCE_FAILED"
  | "CANCELLED";

/**
 * One GPS check-in attempt as returned to the client.
 *
 * Coordinates are numbers here but `Decimal(10,7)` in the database; the service
 * converts at the boundary. They are nullable because a failed attempt never
 * produced a position — `verificationStatus`, not the presence of coordinates,
 * is what says whether a location was verified.
 */
export interface GpsCheckInSummary {
  checkInId: ID;
  verificationStatus: GpsVerificationStatus;
  permissionStatus: GpsPermissionStatus;
  networkStatus: GpsNetworkStatus;
  failureReason: GpsFailureReason | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  /** ISO-8601. Device-reported; never the authoritative clock. */
  locationTimestamp: string | null;
  /** ISO-8601, server clock. Null unless `verificationStatus` is VERIFIED. */
  verifiedAt: string | null;
  createdAt: string;
  /** Scope the check-in was recorded under, from the session — not the request. */
  branchId: ID;
}

/**
 * Whether the caller may proceed into field operations right now.
 *
 * `verified` is the gate. It is false whenever no VERIFIED check-in exists for
 * the current session inside the configured validity window, so an expired
 * check-in is indistinguishable from never having checked in — which is the
 * fail-closed behaviour the story requires.
 */
export interface CheckInStatusResponse {
  verified: boolean;
  checkIn: GpsCheckInSummary | null;
  /** Configured validity window, so the UI can say when re-verification is due. */
  validityHours: number;
}

export interface SubmitCheckInResponse {
  checkIn: GpsCheckInSummary;
  /** Convenience mirror of `checkIn.verificationStatus === "VERIFIED"`. */
  verified: boolean;
  /** True when this request matched an existing `clientAttemptId` and wrote nothing. */
  duplicate: boolean;
}

export interface CheckInHistoryResponse {
  checkIns: GpsCheckInSummary[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** ACTIVE | INACTIVE, shared by organizations and branches. */
export type LifecycleStatus = "ACTIVE" | "INACTIVE";

/**
 * The caller's own organization (Company Settings). There is no list or
 * cross-tenant read: a Super Admin's scope is one organization, resolved from
 * the JWT, so this type describes the only organization they can ever see.
 */
export interface OrganizationDetail {
  orgId: ID;
  /** Immutable. Shown read-only — it identifies the tenant at sign-in. */
  code: string;
  name: string;
  legalName?: string;
  logoFileRef?: string;
  timezone: string;
  status: LifecycleStatus;
  /** Set together when status is INACTIVE, both null while ACTIVE. */
  deactivatedAt?: string;
  deactivationReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** Row shape for the branch list. */
export interface BranchSummary {
  branchId: ID;
  code: string;
  name: string;
  city: string;
  state: string;
  status: LifecycleStatus;
}

export interface BranchDetail extends BranchSummary {
  addressLine1: string;
  addressLine2?: string;
  pincode: string;
  phone?: string;
  contactEmail?: string;
  deactivatedAt?: string;
  deactivationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BranchListResponse {
  branches: BranchSummary[];
}

/**
 * One category of record standing in the way of a branch delete.
 *
 * Returned in the 409 body so the UI can say what is blocking rather than a
 * bare refusal — the story requires the user be told to deactivate instead
 * (Scenario 30), which is only actionable if they can see why.
 */
export interface BranchDeleteBlocker {
  /** Prisma model name, e.g. "loan". Stable enough to key a translation on. */
  entity: string;
  /** Human-readable plural, e.g. "Loans". */
  label: string;
  count: number;
}

export interface DeleteBranchResponse {
  branchId: ID;
  deleted: boolean;
}

/** The 409 body when downstream references exist. */
export interface BranchDeleteBlockedResponse {
  message: string;
  blockedBy: BranchDeleteBlocker[];
}

/* -------------------------------------------------------------------------- */
/* Module 03 — Users, Employees, Roles & Permissions                          */
/* -------------------------------------------------------------------------- */

/** Account lifecycle — see USER_STATUS in @lms/constants for what each means. */
export type UserAccountStatus =
  "ACTIVE" | "INACTIVE" | "LOCKED" | "SUSPENDED" | "PENDING";

/** Role lifecycle. Only ACTIVE roles contribute permissions. */
export type RoleLifecycleStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

/**
 * Row shape for the user and employee lists.
 *
 * One type for both surfaces because they are one table: an employee is a user
 * carrying an `employeeCode`, and its presence is what distinguishes them.
 *
 * Deliberately has no field for `passwordHash`, `failedLoginAttempts` or
 * `lockedUntil`: credential state belongs to the authentication module, and its
 * absence here is what keeps it from reaching a client through this surface.
 */
export interface UserSummary {
  userId: ID;
  name: string;
  /** The login identifier. Nullable in the schema, always set in practice. */
  mobile?: string;
  email?: string;
  /** Present iff this record is an employee rather than an administrator. */
  employeeCode?: string;
  /** Absent for an organization-wide administrator. */
  branchId?: ID;
  branchName?: string;
  status: UserAccountStatus;
  /** Codes of every role held, active or not — the list shows assignment. */
  roles: string[];
}

export interface UserDetail extends UserSummary {
  createdAt: string;
  updatedAt: string;
  /** Absent when the account has never authenticated. */
  lastLoginAt?: string;
}

export interface UserListResponse {
  users: UserSummary[];
}

/**
 * One category of record standing in the way of a user delete.
 *
 * Almost always non-empty in practice: `AuditLog.actorUserId` references the
 * user, so anyone who has ever signed in is permanently undeletable. That is
 * Rules 14 and 43 working as intended, and the reason the UI must present
 * deactivation as the primary action.
 */
export interface UserDeleteBlocker {
  entity: string;
  label: string;
  count: number;
}

export interface DeleteUserResponse {
  userId: ID;
  deleted: boolean;
}

export interface UserDeleteBlockedResponse {
  message: string;
  blockedBy: UserDeleteBlocker[];
}

/** Row shape for the role list. */
export interface RoleSummary {
  roleId: ID;
  /** Immutable once created — it is what permission grants are reasoned about. */
  code: string;
  name: string;
  description?: string;
  status: RoleLifecycleStatus;
  /** A system role refuses rename, deactivate, delete and permission removal. */
  isSystem: boolean;
  permissionCount: number;
  assignedUserCount: number;
}

export interface RoleDetail extends RoleSummary {
  /** Granted `Permission.code` values. Empty is valid for a DRAFT role. */
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleListResponse {
  roles: RoleSummary[];
}

export interface RoleDeleteBlocker {
  entity: string;
  label: string;
  count: number;
}

export interface DeleteRoleResponse {
  roleId: ID;
  deleted: boolean;
}

export interface RoleDeleteBlockedResponse {
  message: string;
  blockedBy: RoleDeleteBlocker[];
}

/** One entry of the permission catalog the role editor lists. */
export interface PermissionSummary {
  code: string;
  /** Groups the editor's checkboxes, e.g. "branches". */
  module: string;
  action: string;
  description?: string;
  /**
   * Whether the requesting actor may grant this permission — the delegation
   * subset rule (Rule 27) surfaced before submit rather than only on rejection.
   * False means the actor does not hold it themselves.
   */
  delegable: boolean;
}

export interface PermissionCatalogResponse {
  permissions: PermissionSummary[];
}

/**
 * The authenticated principal, as returned by the API after sign-in and from
 * `GET /auth/me`. Never carries a token or password — those live only in
 * httpOnly cookies.
 */
export interface AuthUser {
  id: ID;
  /** Tenant scope. Every downstream query must be filtered by this. */
  orgId: ID;
  /** Globally unique organization code, as typed on the sign-in form. */
  orgCode: string;
  name: string;
  mobile: string;
  /** Optional: `User.email` is nullable, and sign-in is by mobile. */
  email?: string;
  /**
   * A user may hold several roles — `UserRole` is keyed [orgId, userId, roleId].
   *
   * `string[]` rather than `Role[]`: from Module 03 an administrator can create
   * roles with arbitrary codes, so the closed {@link Role} union cannot describe
   * what this field actually holds. {@link Role} remains the type for the
   * well-known seeded codes that routing switches on.
   */
  roles: string[];
  /** Effective `Permission.code` list. Authentication alone grants none of these. */
  permissions: string[];
  /** Absent for SUPER_ADMIN, who is not scoped to a branch. */
  branchId?: ID;
  branchName?: string;
  /**
   * True while a password an administrator chose is still in force.
   *
   * The client uses it to send the user to Change Password and nothing else.
   * It is a hint for the interface, not the control: the API enforces the same
   * confinement in `JwtAuthGuard`, so a client that ignores this is refused
   * rather than obeyed.
   */
  mustChangePassword?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Module 04 — Customers & KYC                                                */
/* -------------------------------------------------------------------------- */

/**
 * Customer type. Explicit rather than inferred from the presence of KYC data
 * (Rule 5): a LOCAL customer is a deliberate onboarding choice, not a KYC
 * customer whose documents happen to be missing.
 */
export type CustomerType = "KYC" | "LOCAL";

/**
 * Customer lifecycle (Q-CUST-1).
 *
 * There is no DRAFT and no KYC_REVISION_REQUIRED here — revision is a KYC state,
 * and duplicating it across two enums would let them disagree about the same
 * customer.
 */
export type CustomerLifecycleStatus =
  "PENDING" | "ACTIVE" | "INACTIVE" | "BLOCKED";

/**
 * KYC lifecycle (Q-CUST-2). A LOCAL customer has no KYC record at all, which is
 * why there is no NOT_REQUIRED member: absence is the representation.
 */
export type KycLifecycleStatus =
  "PENDING" | "SUBMITTED" | "REVISION_REQUIRED" | "APPROVED" | "REJECTED";

/** Per-document review state, independent of the overall KYC decision. */
export type DocumentVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

/** Guarantor consent (Scenario 25). `consentAt` is set only on GIVEN. */
export type ConsentStatus = "PENDING" | "GIVEN" | "REJECTED";

/**
 * Guarantor lifecycle (Module 05, Scenarios 26-30).
 *
 * ACTIVE | INACTIVE only, as for organizations and branches. Deactivation is
 * the supported removal path once a guarantor is referenced downstream; it never
 * detaches historical loan relationships (Rules 35, 38).
 */
export type GuarantorStatus = "ACTIVE" | "INACTIVE";

/**
 * Guarantor KYC state (Module 05, Scenarios 20-25).
 *
 * Deliberately not `KycLifecycleStatus`. `NOT_REQUIRED` is the default, because
 * whether a guarantor needs KYC at all is a loan-product rule that does not
 * exist yet (Rule 3, Q-GUAR-11) — and it is a state the borrower flow has no use
 * for. Guarantor KYC is tracked separately from the borrower's throughout
 * (Rule 18, Scenario 22).
 */
export type GuarantorKycStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "SUBMITTED"
  | "REVISION_REQUIRED"
  | "APPROVED"
  | "REJECTED";

/**
 * Guarantor KYC document categories.
 *
 * The same three the borrower pack uses, but a distinct type: the required set
 * differs (ID + ADDRESS, no PHOTO — Q-GUAR-9), and sharing one type would make a
 * later divergence in either pack silently change the other.
 */
export type GuarantorDocumentType = "ID" | "ADDRESS" | "PHOTO";

/**
 * The three document categories the source names for standard KYC.
 *
 * Loan-side documents (income, collateral) are deliberately not members: the
 * story warns they must not be folded into the same domain category.
 */
export type KycDocumentType = "ID" | "ADDRESS" | "PHOTO";

/**
 * Row shape for the customer list and search results.
 *
 * `mobile` here is **masked** (Q-CUST-21). A search screen is the widest surface
 * in the module and should not double as a bulk PII export; the unmasked number
 * appears only on {@link CustomerDetail}.
 */
export interface CustomerSummary {
  customerId: ID;
  customerCode: string;
  customerType: CustomerType;
  fullName: string;
  /** Masked, e.g. `98****3210`. */
  mobile: string;
  status: CustomerLifecycleStatus;
  branchId: ID;
  branchName?: string;
  /** Absent for a LOCAL customer, which has no KYC record. */
  kycStatus?: KycLifecycleStatus;
  /** True once a completed OTP round-trip has verified the number. */
  mobileVerified: boolean;
  createdAt: string;
}

export interface CustomerDetail extends Omit<CustomerSummary, "mobile"> {
  /** Unmasked. Reaching this field requires `customers.view` plus scope. */
  mobile: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  updatedAt: string;
  /**
   * Echoed back as `expectedVersion` on the next write (Q-CUST-22). A mismatch
   * is a 409 rather than a silent overwrite of someone else's committed edit.
   */
  version: string;
}

export interface CustomerListResponse {
  customers: CustomerSummary[];
}

/**
 * A possible duplicate surfaced at creation (Q-CUST-4, Scenario 5).
 *
 * Returned instead of the created customer; the caller re-submits with `force`
 * to proceed. Shared household mobile numbers are legitimate, so this is a flag
 * rather than a unique constraint — but it must never be silent.
 */
export interface CustomerDuplicateResponse {
  message: string;
  duplicateOf: Array<{
    customerId: ID;
    customerCode: string;
    fullName: string;
    status: CustomerLifecycleStatus;
  }>;
}

/** One category of record standing in the way of a customer delete. */
export interface CustomerDeleteBlocker {
  entity: string;
  label: string;
  count: number;
}

export interface DeleteCustomerResponse {
  customerId: ID;
  deleted: boolean;
}

export interface CustomerDeleteBlockedResponse {
  message: string;
  blockedBy: CustomerDeleteBlocker[];
}

/** The KYC record attached to a KYC-type customer. */
export interface KycRecord {
  kycId: ID;
  customerId: ID;
  status: KycLifecycleStatus;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: ID;
  reviewedByName?: string;
  /** Set when status is REVISION_REQUIRED or REJECTED. */
  revisionReason?: string;
  updatedAt: string;
  /** Optimistic-concurrency handle, as on {@link CustomerDetail}. */
  version: string;
}

/**
 * A stored KYC document.
 *
 * Carries no URL by design: the bytes are reachable only through an endpoint
 * that re-checks organization and branch scope on every request and audits the
 * access (Scenarios 12, 32).
 */
export interface CustomerDocumentSummary {
  documentId: ID;
  customerId: ID;
  documentType: KycDocumentType;
  documentNumber?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  /** Increments on each replacement; the prior version is retained. */
  version: number;
  /** Set on the older row once a replacement is uploaded (Scenario 11). */
  supersededAt?: string;
  verificationStatus: DocumentVerificationStatus;
  verificationReason?: string;
  verifiedAt?: string;
  uploadedAt: string;
}

export interface GuarantorSummary {
  guarantorId: ID;
  customerId: ID;
  fullName: string;
  mobile: string;
  address?: string;
  relationship?: string;
  status: GuarantorStatus;
  deactivatedAt?: string;
  deactivationReason?: string;
  consentStatus: ConsentStatus;
  consentAt?: string;
  /** The LMS user who recorded the decision — consent here is staff-recorded. */
  consentBy?: ID;
  kycStatus: GuarantorKycStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * Optimistic-concurrency token, the ISO `updatedAt` (Q-GUAR-67). Sent back as
   * `expectedVersion` on any write; a stale one is refused with a 409 rather
   * than silently overwriting a committed change (Scenario 46).
   */
  version: string;
}

/** Guarantor KYC document, structurally separate from the borrower's pack. */
export interface GuarantorDocumentSummary {
  documentId: ID;
  guarantorId: ID;
  documentType: GuarantorDocumentType;
  documentNumber?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  /** Increments on each replacement; the prior version is retained. */
  version: number;
  supersededAt?: string;
  verificationStatus: DocumentVerificationStatus;
  verificationReason?: string;
  verifiedAt?: string;
  uploadedAt: string;
}

/**
 * The guarantor detail screen (GUA-002).
 *
 * Carries the customer's identity because a guarantor is only ever meaningful
 * through the customer they stand for, and `branchId` is read from that customer
 * rather than stored on the guarantor (Rule 10).
 */
export interface GuarantorDetail extends GuarantorSummary {
  customerName: string;
  customerCode: string;
  branchId: ID;
  kycSubmittedAt?: string;
  kycReviewedAt?: string;
  kycReviewedBy?: ID;
  kycReviewedByName?: string;
  kycRevisionReason?: string;
}

/** The guarantor detail screen's aggregate payload. */
export interface GuarantorProfileResponse {
  guarantor: GuarantorDetail;
  documents: GuarantorDocumentSummary[];
}

export interface GuarantorDeleteBlocker {
  entity: string;
  label: string;
  count: number;
}

export interface DeleteGuarantorResponse {
  guarantorId: ID;
  deleted: boolean;
}

export interface GuarantorDeleteBlockedResponse {
  message: string;
  blockedBy: GuarantorDeleteBlocker[];
}

/** Why a guarantor is not yet usable for a loan application (Scenario 41). */
export type GuarantorReadinessReason =
  "INACTIVE" | "CONSENT_PENDING" | "CONSENT_REJECTED" | "KYC_INCOMPLETE";

export interface GuarantorReadinessBlocker {
  guarantorId: ID;
  fullName: string;
  reasons: GuarantorReadinessReason[];
}

/**
 * The loan-application guarantor gate (Scenarios 41-43).
 *
 * `required` is always `null` and deliberately so: whether a guarantor is
 * required at all is a loan-product rule, and that module does not exist yet
 * (Rule 3, Q-GUAR-11). This module answers "are the guarantors that exist
 * usable"; Module 07 decides whether an answer of "there are none" is a problem.
 * A customer with no guarantors is therefore `satisfied: true` (Scenarios 7, 43).
 */
export interface GuarantorReadiness {
  required: null;
  satisfied: boolean;
  blockers: GuarantorReadinessBlocker[];
}

/** The customer profile screen's aggregate payload. */
export interface CustomerProfileResponse {
  customer: CustomerDetail;
  /** Absent for LOCAL customers. */
  kyc?: KycRecord;
  documents: CustomerDocumentSummary[];
  guarantors: GuarantorSummary[];
}

// ---------------------------------------------------------------------------
// Modules 06-07 — Loan Products, Schemes and Applications
// ---------------------------------------------------------------------------

/**
 * Money crosses the wire as a decimal string of integer paise, not a number.
 *
 * The API holds these as `bigint` and JSON has no bigint; serializing through
 * `Number` would start losing paise above ~90,000 crore, and `JSON.stringify`
 * throws on a raw bigint rather than doing anything sensible. A string is the
 * only representation that survives the round trip intact — parse it back with
 * `BigInt(value)`, never `Number(value)`.
 */
export type PaiseString = string;

/** Integer basis points as a decimal string, for the same reason as PaiseString. */
export type BpsString = string;

/**
 * A `LOAN_TYPE` master-data code.
 *
 * Was a union of the four types the codebase knew about. Loan types are
 * admin-managed per tenant now, so the set is open — a tenant may define one
 * this package has never heard of, and a closed union would make such a product
 * untypeable. `PERSONAL`, `BUSINESS`, `GOLD` and `VEHICLE` are still what every
 * org is seeded with; they are simply no longer the only possibilities.
 */
export type LoanType = string;
export type InterestType = "FLAT" | "REDUCING" | "CUSTOM_RATE";
export type RepaymentFrequency =
  "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export type LoanProductStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
export type LoanSchemeStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

/**
 * Application lifecycle states reachable in this system.
 *
 * DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> SANCTIONED ->
 * CUSTOMER_ACCEPTED -> AGREEMENT_SIGNED, with MORE_INFO_REQUIRED and REJECTED
 * branching off review, and a customer's decline of the sanction letter landing
 * on REJECTED.
 *
 * Four Prisma enum values are deliberately absent:
 *
 * - `CUSTOMER_REJECTED` — Module 08 Rule 13 unifies an admin rejection and a
 *   customer decline into one REJECTED status carrying a separate reason. A
 *   second terminal status would fork every consumer of `status === "REJECTED"`
 *   — the list filter, the badge, the "already decided" refusal — which is the
 *   drift Rule 13 exists to prevent. A decline is distinguished by its review
 *   entry's SANCTION `reviewType`, not by its status.
 * - `CLOSED` — Module 15's (Loan Closure).
 *
 * Module 09 added the last two values. AGREEMENT_SIGNED was terminal here as a
 * module boundary, not as a business rule, and disbursal is what moves past it:
 *
 *   AGREEMENT_SIGNED -> DISBURSEMENT_PENDING -> DISBURSED
 *
 * DISBURSEMENT_PENDING means a disbursement has been scheduled and the loan row
 * exists; DISBURSED means the money moved and the ledger balanced. A failed
 * transfer leaves the application at DISBURSEMENT_PENDING and is retryable —
 * that is the whole point of having two states rather than one.
 */
export type ApplicationStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "MORE_INFO_REQUIRED"
  | "REJECTED"
  | "APPROVED"
  | "SANCTIONED"
  | "CUSTOMER_ACCEPTED"
  | "AGREEMENT_SIGNED"
  | "DISBURSEMENT_PENDING"
  | "DISBURSED";

export type ApplicationDocumentStatus = "PENDING" | "VERIFIED" | "REJECTED";

export interface LoanProductSummary {
  loanProductId: ID;
  code: string;
  name: string;
  loanType: LoanType;
  status: LoanProductStatus;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency token, the ISO `updatedAt`. */
  version: string;
}

export interface LoanProductDetail extends LoanProductSummary {
  /** Schemes hanging off this product, newest first. */
  schemes: LoanSchemeSummary[];
}

export interface LoanSchemeDurationOption {
  loanSchemeDurationId: ID;
  frequency: RepaymentFrequency;
  /** The accepted count, or the default the form pre-fills when ranged. */
  durationCount: number;
  /**
   * An inclusive range of accepted counts, or null for an exact term.
   *
   * Set for a term the borrower states rather than picks — a daily loan runs to
   * a date, so its count is whatever those dates imply. Both are null or both
   * are set; never one alone.
   */
  minDurationCount: number | null;
  maxDurationCount: number | null;
  status: "ACTIVE" | "INACTIVE";
}

export interface LoanSchemeSummary {
  loanSchemeId: ID;
  loanProductId: ID;
  code: string;
  name: string;
  interestType: InterestType;
  interestRateBps: BpsString;
  status: LoanSchemeStatus;
  createdAt: string;
  updatedAt: string;
  version: string;
}

export interface LoanSchemeDetail extends LoanSchemeSummary {
  productCode: string;
  productName: string;
  loanType: LoanType;
  durations: LoanSchemeDurationOption[];
}

/** One installment of a proposed repayment schedule. */
export interface EmiInstallmentView {
  installmentNumber: number;
  /** DATE-only `YYYY-MM-DD`, Asia/Kolkata. */
  dueDate: string;
  principalPaise: PaiseString;
  interestPaise: PaiseString;
  totalPaise: PaiseString;
  closingBalancePaise: PaiseString;
}

/** The EMI preview shown at wizard step 4 and on the application detail screen. */
export interface EmiScheduleView {
  installmentAmountPaise: PaiseString;
  /** Absorbs all rounding residue, so the installments sum exactly to the total. */
  finalInstallmentPaise: PaiseString;
  totalPrincipalPaise: PaiseString;
  totalInterestPaise: PaiseString;
  totalPayablePaise: PaiseString;
  installmentCount: number;
  firstDueDate: string;
  lastDueDate: string;
  installments: EmiInstallmentView[];
}

export interface LoanApplicationSummary {
  applicationId: ID;
  applicationNumber: string;
  customerId: ID;
  customerName: string;
  customerCode: string;
  branchId: ID;
  requestedAmountPaise: PaiseString;
  purpose?: string;
  loanType: LoanType;
  schemeName: string;
  interestType: InterestType;
  interestRateBps: BpsString;
  repaymentFrequency: RepaymentFrequency;
  durationCount: number;
  status: ApplicationStatus;
  rejectionReason?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Optimistic-concurrency token, the ISO `updatedAt`. */
  version: string;
}

export interface LoanApplicationDetail extends LoanApplicationSummary {
  branchName: string;
  loanProductId: ID;
  loanSchemeId: ID;
  productCode: string;
  schemeCode: string;
  approvedAt?: string;
  approvedBy?: ID;
  /** Module 08 lifecycle timestamps. Absent until the step has happened. */
  sanctionedAt?: string;
  customerRespondedAt?: string;
  agreementSignedAt?: string;
  documents: LoanApplicationDocumentSummary[];
  /**
   * Recomputed from the stored terms on every read rather than persisted, so it
   * can never disagree with the terms it claims to describe. `null` when the
   * stored terms no longer compute — which blocks approval rather than hiding.
   */
  emi: EmiScheduleView | null;
}

export interface LoanApplicationDocumentSummary {
  applicationDocumentId: ID;
  applicationId: ID;
  documentType: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  documentNumber?: string;
  /** Replacements insert at `version + 1`; superseded rows keep their history. */
  version: number;
  supersededAt?: string;
  status: ApplicationDocumentStatus;
  verificationReason?: string;
  verifiedAt?: string;
  verifiedBy?: ID;
  uploadedBy: ID;
  createdAt: string;
}

/** One entry of the append-only review history. */
export interface LoanApplicationHistoryEntry {
  reviewId: ID;
  /**
   * `SANCTION` covers issue, acceptance, decline and agreement signing. It is
   * what distinguishes a customer's decline (SANCTION + REJECTED) from an
   * admin's rejection (FINAL_APPROVAL + REJECTED) under Rule 13's unified
   * REJECTED status.
   */
  reviewType:
    | "BRANCH_REVIEW"
    | "CREDIT_REVIEW"
    | "FINAL_APPROVAL"
    | "MODIFY_TERMS"
    | "SANCTION";
  decision:
    | "APPROVED"
    | "REJECTED"
    | "MORE_INFO_REQUIRED"
    | "TERMS_MODIFIED"
    | "SANCTIONED"
    | "CUSTOMER_ACCEPTED"
    | "AGREEMENT_SIGNED";
  reviewerId: ID;
  reviewerName: string;
  comments?: string;
  rejectionReason?: string;
  /**
   * Terms as they stood *before* this change; set only on MODIFY_TERMS entries.
   * Replaying entries oldest-first reconstructs every set of terms the
   * application has had, with the originally submitted terms on the earliest
   * MODIFY_TERMS row.
   */
  previousInterestType?: InterestType;
  previousInterestRateBps?: BpsString;
  previousFrequency?: RepaymentFrequency;
  previousDurationCount?: number;
  createdAt: string;
}

// --- Module 08: Approval Workflow -------------------------------------------

export type CreditAssessmentResult = "PASS" | "FAIL" | "MANUAL_REVIEW";

/**
 * One recorded credit assessment (CIBIL and income check).
 *
 * `incomeVerified` absent means "not checked"; `false` means "checked and
 * failed". Collapsing the two is exactly the failure Scenario 9 is about, so
 * the field is optional rather than defaulted.
 */
export interface CreditAssessmentDetail {
  assessmentId: ID;
  applicationId: ID;
  cibilScore?: number;
  incomeVerified?: boolean;
  incomeMonthlyPaise?: PaiseString;
  assessmentResult?: CreditAssessmentResult;
  assessmentNotes?: string;
  assessedBy?: ID;
  assessorName?: string;
  assessedAt?: string;
  /** Set once a later assessment replaced this one. Superseded rows are never
   * deleted — they are what makes an override auditable. */
  supersededAt?: string;
  createdAt: string;
}

export interface CreditAssessmentHistory {
  applicationId: ID;
  /** The one assessment with no `supersededAt`, or null if none was recorded. */
  current: CreditAssessmentDetail | null;
  /** Superseded assessments, newest first. */
  superseded: CreditAssessmentDetail[];
}

export type SanctionResponse = "PENDING" | "ACCEPTED" | "DECLINED";

/**
 * The sanction letter issued after approval.
 *
 * Its terms are snapshotted from the application at issue, not supplied by the
 * caller, so sanctioned terms cannot drift from approved terms.
 */
export interface SanctionLetterDetail {
  sanctionLetterId: ID;
  applicationId: ID;
  sanctionNumber: string;
  sanctionedAmountPaise: PaiseString;
  interestType: InterestType;
  interestRateBps: BpsString;
  repaymentFrequency: RepaymentFrequency;
  durationCount: number;
  installmentAmountPaise: PaiseString;
  totalPayablePaise: PaiseString;
  issuedAt: string;
  issuedBy: ID;
  issuerName?: string;
  /** Recorded, not enforced: the source defines no expiry behaviour. */
  validUntil?: string;
  notes?: string;
  customerResponse: SanctionResponse;
  customerRespondedAt?: string;
  /** Who *recorded* the response. Acceptance is a staff-recorded fact — there
   * is no customer-facing surface in this system. */
  responseRecordedBy?: ID;
  declineReason?: string;
  agreementSignedAt?: string;
  agreementReference?: string;
  version: string;
}

export type ApprovalBlockerKey = "STATUS" | "EMI" | "DOCUMENTS" | "ASSESSMENT";

export interface ApprovalBlocker {
  key: ApprovalBlockerKey;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Everything standing between an application and approval.
 *
 * Advisory: the approve endpoint re-runs every one of these checks, twice.
 * This exists so the reviewer's screen can show what is outstanding before the
 * button is pressed. Deliberately separate from `ApplicationCompleteness`,
 * which answers "could this be submitted" and is rendered by the wizard.
 */
export interface ApprovalReadiness {
  applicationId: ID;
  approvable: boolean;
  blockers: ApprovalBlocker[];
  assessment: CreditAssessmentDetail | null;
  version: string;
}

/** The checks a completeness evaluation runs, in fixed display order. */
export type CompletenessCheckKey =
  | "CUSTOMER_ACTIVE"
  | "SCHEME_ACTIVE"
  | "DURATION_SUPPORTED"
  | "AMOUNT_VALID"
  | "PURPOSE_PRESENT"
  | "RATE_VALID"
  | "GUARANTORS_READY"
  | "DOCUMENTS_COMPLETE"
  | "EMI_COMPUTES";

export interface CompletenessCheck {
  key: CompletenessCheckKey;
  satisfied: boolean;
  /** Machine-readable code; the web maps it to copy. Absent when satisfied. */
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Wizard step 6's validation summary.
 *
 * `submittable` is advisory only — the submit endpoint re-runs every check
 * inside its own transaction, so a scheme deactivated between this call and the
 * submit is still caught.
 */
export interface ApplicationCompleteness {
  applicationId: ID;
  submittable: boolean;
  /** All checks, satisfied or not, so the UI can render stable green ticks. */
  checks: CompletenessCheck[];
  missingDocumentTypes: string[];
  emi: EmiScheduleView | null;
  /** The application's current version, so step 6 can submit without re-fetching. */
  version: string;
}

// ============================================================================
// Module 09 — Disbursal
//
// The first module that moves money, and so the first whose types describe a
// financial record rather than an intention. Every paise value crosses the wire
// as a string for the reason PaiseString documents.
// ============================================================================

/**
 * Why a disbursement cannot proceed. The advisory twin of the server's own
 * gates — the confirm endpoint re-runs every one of these inside its
 * transaction, so a blocker that appears between this call and the confirm is
 * still caught (Rules 47, 53, 54).
 */
export type DisbursalBlockerKey =
  | "NOT_AGREEMENT_SIGNED"
  | "SANCTION_NOT_ACCEPTED"
  | "ALREADY_DISBURSED"
  | "ACCOUNT_INACTIVE"
  | "ACCOUNT_OUT_OF_SCOPE"
  | "AMOUNT_MISMATCH"
  | "NO_TRANSFER_RECORDED";

export interface DisbursalBlocker {
  key: DisbursalBlockerKey;
  reason: string;
  details?: Record<string, unknown>;
}

export interface DisbursalReadiness {
  disbursementId: ID;
  /** Advisory only. The confirm endpoint is the authority. */
  confirmable: boolean;
  blockers: DisbursalBlocker[];
  version: string;
}

/** A loan awaiting disbursal, as it appears in the queue (Scenario 1). */
export interface DisbursalQueueItem {
  applicationId: ID;
  applicationNumber: string;
  customerId: ID;
  customerName: string;
  customerCode: string;
  branchId: ID;
  sanctionedAmountPaise: PaiseString;
  agreementSignedAt: string;
  /** Present once a disbursement has been scheduled against the loan. */
  disbursementId?: ID;
  loanId?: ID;
  loanNumber?: string;
  disbursementStatus?: DisbursementStatus;
  scheduledDate?: string;
}

export interface DisbursementSummary {
  disbursementId: ID;
  loanId: ID;
  loanNumber: string;
  applicationId: ID;
  applicationNumber: string;
  customerId: ID;
  customerName: string;
  branchId: ID;
  status: DisbursementStatus;
  /** DATE-only, Asia/Kolkata. */
  scheduledDate: string;
  amountPaise: PaiseString;
  paymentMode: PaymentMode;
  transactionReference?: string;
  transferDate?: string;
  disbursedAt?: string;
  createdAt: string;
  /** Optimistic-concurrency token, the ISO `updatedAt`. */
  version: string;
}

export interface DisbursementDetail extends DisbursementSummary {
  disbursementAccountId: ID;
  disbursementAccountCode: string;
  disbursementAccountName: string;
  /** ACTIVE at read time — revalidated again at confirm (Scenario 36). */
  disbursementAccountStatus: "ACTIVE" | "INACTIVE";
  bankAccountReference?: string;
  failureReason?: string;
  createdBy: ID;
  createdByName?: string;
  confirmedBy?: ID;
  confirmedByName?: string;
  confirmedAt?: string;
  /** Set once the ledger posting has committed. */
  journalEntryId?: ID;
  /** Snapshotted terms the schedule will be built from. */
  interestType: InterestType;
  interestRateBps: BpsString;
  repaymentFrequency: RepaymentFrequency;
  durationCount: number;
  agreementSignedAt?: string;
  agreementReference?: string;
}

/** One side of a journal entry. Debit and credit are never both non-zero. */
export interface LedgerLineView {
  lineNumber: number;
  accountCode: string;
  accountName: string;
  debitPaise: PaiseString;
  creditPaise: PaiseString;
  description?: string;
}

/**
 * A journal entry.
 *
 * `totalDebitPaise` and `totalCreditPaise` are returned rather than left for
 * the client to sum, so the UI's balance assertion (Scenario 19) reads the same
 * numbers the database enforced.
 */
export interface LedgerEntryDetail {
  journalEntryId: ID;
  entryNumber: string;
  entryDate: string;
  /**
   * Absent while the entry is a DRAFT.
   *
   * Module 14 introduced the draft state; before it, every journal row was born
   * POSTED and this was always present. A draft has not been posted, so the
   * field is omitted rather than carrying a placeholder instant.
   */
  postedAt?: string;
  entryType: string;
  status: "DRAFT" | "POSTED" | "REVERSED";
  description?: string;
  lines: LedgerLineView[];
  totalDebitPaise: PaiseString;
  totalCreditPaise: PaiseString;
  balanced: boolean;
}

export interface EmiRow {
  emiId: ID;
  installmentNumber: number;
  /** DATE-only, Asia/Kolkata. */
  dueDate: string;
  /** Principal outstanding before this installment. */
  openingPrincipalPaise: PaiseString;
  principalDuePaise: PaiseString;
  interestDuePaise: PaiseString;
  totalDuePaise: PaiseString;
  paidAmountPaise: PaiseString;
  outstandingAmountPaise: PaiseString;
  /**
   * The *persisted* status. Stays `PENDING` until a payment or lifecycle action
   * writes to the row — it does not advance with the calendar.
   */
  status: EmiStatus;
  /**
   * The status to display: `status` when a payment has settled it, otherwise
   * `PENDING`/`DUE`/`OVERDUE` derived server-side from the Asia/Kolkata business
   * date. Always render this one — the client's clock is never consulted
   * (Module 10 Scenarios 23, 24, 39).
   */
  effectiveStatus: EmiStatus;
  paidAt?: string;
}

/**
 * The repayment schedule generated at disbursal.
 *
 * Versioned because Module 11 may supersede it on restructuring; version 1 is
 * the one disbursal creates, and it is the only ACTIVE one at that point.
 */
export interface RepaymentScheduleDetail {
  repaymentScheduleId: ID;
  loanId: ID;
  version: number;
  status: RepaymentScheduleStatus;
  generatedAt: string;
  installments: EmiRow[];
  totalPrincipalPaise: PaiseString;
  totalInterestPaise: PaiseString;
  totalPayablePaise: PaiseString;
}

// ============================================================================
// Module 10 — Repayment Schedule
// ============================================================================

export type RepaymentScheduleStatus = "ACTIVE" | "SUPERSEDED" | "CANCELLED";

/**
 * Why a schedule may not be regenerated right now.
 *
 * Shaped like `DisbursalBlocker`, and for the same reason: the caller is told
 * every reason at once rather than discovering them one refusal at a time. The
 * three reference keys carry a `count`, because "3 collections are allocated
 * against this schedule" is a different conversation from "1 is".
 */
export type ScheduleRegenerationBlockerKey =
  | "ALLOCATIONS_EXIST"
  | "PENALTIES_EXIST"
  | "RECOVERY_CASES_EXIST"
  | "LOAN_NOT_ACTIVE"
  | "SCHEDULE_NOT_ACTIVE"
  | "NO_SCHEDULE";

export interface ScheduleRegenerationBlocker {
  key: ScheduleRegenerationBlockerKey;
  message: string;
  /** How many downstream rows block it. Absent for the status blockers. */
  count?: number;
}

/** The loan terms a schedule was generated from — the story's Loan Summary. */
export interface ScheduleLoanSummary {
  loanId: ID;
  loanNumber: string;
  customerId: ID;
  customerName: string;
  branchId: ID;
  branchName: string;
  status: LoanStatus;
  principalAmountPaise: PaiseString;
  interestRateBps: BpsString;
  interestType: InterestType;
  repaymentFrequency: RepaymentFrequency;
  durationCount: number;
  /** DATE-only. The anchor the schedule's due dates were counted from. */
  disbursementDate?: string;
}

/**
 * The story's Schedule Summary block.
 *
 * Every figure is summed server-side from the persisted rows. A client-side sum
 * would agree with whatever it was sent, which is no check at all.
 */
export interface ScheduleTotals {
  installmentCount: number;
  totalPrincipalPaise: PaiseString;
  totalInterestPaise: PaiseString;
  totalPayablePaise: PaiseString;
  totalPaidPaise: PaiseString;
  outstandingPaise: PaiseString;
  /** DATE-only. The earliest unsettled installment, absent once all are paid. */
  nextDueDate?: string;
}

/** One row of the branch-scoped schedule list (Scenario 2). */
export interface RepaymentScheduleSummary {
  repaymentScheduleId: ID;
  loanId: ID;
  loanNumber: string;
  customerName: string;
  branchName: string;
  version: number;
  status: RepaymentScheduleStatus;
  installmentCount: number;
  totalPayablePaise: PaiseString;
  outstandingPaise: PaiseString;
  nextDueDate?: string;
  generatedAt: string;
}

/**
 * The full repayment-schedule screen.
 *
 * `version` is the schedule's own version number; `expectedVersion` is the
 * optimistic-concurrency token a mutation must echo back, and the two are
 * unrelated — a stale client is refused on the second, not the first
 * (Scenarios 36, 41).
 */
export interface RepaymentScheduleView {
  repaymentScheduleId: ID;
  loan: ScheduleLoanSummary;
  version: number;
  status: RepaymentScheduleStatus;
  generatedAt: string;
  supersededAt?: string;
  regenerationReason?: string;
  /** The concurrency token. Echo it back on regenerate. */
  expectedVersion: string;
  totals: ScheduleTotals;
  installments: EmiRow[];
  /** Advisory: the same gates run authoritatively inside the mutation. */
  canRegenerate: boolean;
  regenerationBlockers: ScheduleRegenerationBlocker[];
  /** Superseded versions, newest first. History is never deleted (Rule 22). */
  priorVersions: SupersededScheduleRef[];
}

export interface SupersededScheduleRef {
  repaymentScheduleId: ID;
  version: number;
  generatedAt: string;
  supersededAt?: string;
  regenerationReason?: string;
}

export interface RepaymentScheduleListResult {
  items: RepaymentScheduleSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Module 11 — EMI collection
// ---------------------------------------------------------------------------

/** One movement of a payment against one component of one installment. */
export interface CollectionAllocationView {
  emiId: ID;
  installmentNumber: number;
  /** DATE-only, Asia/Kolkata. */
  dueDate: string;
  component: CollectionComponent;
  amountPaise: PaiseString;
}

/** A collection as it appears in a list. */
export interface CollectionSummary {
  collectionId: ID;
  loanId: ID;
  loanNumber: string;
  customerId: ID;
  customerName: string;
  branchId: ID;
  /** Absent until the collection posts — the number is minted at posting. */
  receiptNumber?: string;
  /** DATE-only. The contractual business date, not the device's clock. */
  collectionDate: string;
  collectedAt: string;
  paymentMode: PaymentMode;
  paymentType: PaymentType;
  amountPaise: PaiseString;
  status: CollectionStatus;
  offlineCollected: boolean;
  collectorUserId: ID;
  collectorName?: string;
  createdAt: string;
  /** The concurrency token. Echo it back on reversal. */
  version: string;
}

/**
 * A collection in full, including its allocation and its ledger link.
 *
 * The four component figures plus `unallocatedAmountPaise` sum to
 * `amountPaise` on any posted row — the same identity the
 * `collections_allocation_sums` CHECK enforces in the database.
 */
export interface CollectionDetail extends CollectionSummary {
  penaltyPaidPaise: PaiseString;
  interestPaidPaise: PaiseString;
  principalPaidPaise: PaiseString;
  feesPaidPaise: PaiseString;
  /** Always "0": overpayment is refused rather than held as credit. */
  unallocatedAmountPaise: PaiseString;
  allocations: CollectionAllocationView[];
  journalEntryId?: ID;
  transactionReference?: string;
  idempotencyKey: string;
  offlineTransactionUuid?: ID;
  deviceId?: string;
  syncedAt?: string;
  postedAt?: string;
  postedBy?: ID;
  /** Set on a reversal row: the collection it reverses. */
  reversalOfCollectionId?: ID;
  /** Set on a reversed original: the reversal that undid it. */
  reversedByCollectionId?: ID;
  reversalReason?: string;
  reversedAt?: string;
  reversedBy?: ID;
  failureReason?: string;
  verificationStatus: PaymentVerificationStatus;
}

export type CollectionBlockerKey =
  | "LOAN_NOT_ACTIVE"
  | "LOAN_CLOSED"
  | "LOAN_WRITTEN_OFF"
  | "NO_ACTIVE_SCHEDULE"
  | "NOTHING_OUTSTANDING"
  | "BRANCH_INACTIVE"
  | "ACCOUNT_INACTIVE"
  | "REFERENCE_REQUIRED";

export interface CollectionBlocker {
  key: CollectionBlockerKey;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * What a loan owes right now, and whether it can be collected against.
 *
 * Advisory: the same gates run authoritatively inside the posting transaction,
 * against a re-read of the loan. This exists so the form can refuse early and
 * explain why, not so the mutation can trust it.
 */
export interface CollectionReadiness {
  loanId: ID;
  loanNumber: string;
  customerName: string;
  branchId: ID;
  collectable: boolean;
  blockers: CollectionBlocker[];
  /**
   * The exact figure a "pay in full" action must tender. Rendering a rounded
   * rupee value here and posting it would be refused as an overpayment.
   */
  totalOutstandingPaise: PaiseString;
  penaltyOutstandingPaise: PaiseString;
  interestOutstandingPaise: PaiseString;
  principalOutstandingPaise: PaiseString;
  feesOutstandingPaise: PaiseString;
  nextDueEmi?: EmiRow;
  installments: EmiRow[];
}

/**
 * What a given amount would settle, computed server-side from authoritative
 * balances (Scenarios 6, 7, 8).
 *
 * Deliberately server-computed even though `@lms/emi` is importable in the
 * browser: the preview must agree with what posting will do, and the only way
 * to guarantee that is for both to run the same code against the same balances.
 */
export interface AllocationPreview {
  amountPaise: PaiseString;
  penaltyPaise: PaiseString;
  interestPaise: PaiseString;
  principalPaise: PaiseString;
  feesPaise: PaiseString;
  unallocatedPaise: PaiseString;
  lines: CollectionAllocationView[];
  fullySettledEmiIds: ID[];
  /** True when this payment would clear the loan's entire outstanding balance. */
  wouldCloseLoan: boolean;
}

export interface CollectionListResult {
  items: CollectionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// Module 12 — Field collection and cash custody
//
// A field collection **is** a Module 11 collection. The types below extend the
// Module 11 shapes rather than restating them, because the row is the same row:
// one loan, one amount, one server-side allocation, one receipt. What Module 12
// adds is custody — the cash sits with a person rather than a branch drawer —
// and the evidence the agent captured while taking it.
//
// The cash types are genuinely new, because a handover and a reconciliation are
// not payments. They move custody between two parties who both already have the
// money on their books, which is why neither carries a loan or a customer.
// ============================================================================

/** What the device reported about its GPS capture attempt. */
export type GpsCaptureStatus = "VERIFIED" | "FAILED" | "PENDING";

/**
 * A field collection as it appears in a list.
 *
 * `custodyHandoverId` is the single most useful field here: absent means the
 * cash is still with the agent and counts toward their expected balance;
 * present means it has been handed over and no longer does. That one column is
 * what makes the balance a derivation rather than a stored running total.
 */
export interface FieldCollectionSummary extends CollectionSummary {
  isFieldCollection: true;
  gpsCaptureStatus?: GpsCaptureStatus;
  /** Set once the cash has been claimed by a handover. */
  custodyHandoverId?: ID;
  custodyHandoverNumber?: string;
}

/** A field collection in full, including its evidence trail. */
export interface FieldCollectionDetail extends CollectionDetail {
  isFieldCollection: true;
  gpsCaptureStatus?: GpsCaptureStatus;
  /**
   * The verified check-in this collection's location evidence came from.
   *
   * Absent on a failed capture, which is the whole reason `gpsCaptureStatus` is
   * stored separately: a failure has no check-in row to point at, and Rule 41
   * requires the failure still be representable.
   */
  gpsCheckInId?: ID;
  gpsLatitude?: string;
  gpsLongitude?: string;
  gpsAccuracyMeters?: string;
  fieldVisitId?: ID;
  customerAckReference?: string;
  custodyHandoverId?: ID;
  custodyHandoverNumber?: string;
  verificationNotes?: string;
  verifiedBy?: ID;
  verifiedAt?: string;
}

export interface FieldCollectionListResult {
  items: FieldCollectionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * How much cash an agent is holding, derived rather than stored (Rule 24).
 *
 * The figure is the sum of the agent's posted, unreversed, unclaimed cash
 * collections. It is recomputed on every read and again inside the handover
 * transaction, because a number cached between those two points is a number
 * that can be wrong at the moment it matters.
 */
export interface AgentCashBalance {
  fieldAgentId: ID;
  agentName: string;
  employeeCode?: string;
  branchId: ID;
  branchName?: string;
  expectedCashPaise: PaiseString;
  unclaimedCollectionCount: number;
  /** DATE-only. How long the oldest uncollected cash has been outstanding. */
  oldestUnclaimedDate?: string;
}

export type CashHandoverStatus =
  | "CREATED"
  | "SUBMITTED"
  | "RECEIVED"
  | "RECONCILED"
  | "CANCELLED"
  | "REVERSED";

/** A handover as it appears in a list. */
export interface CashHandoverSummary {
  handoverId: ID;
  handoverNumber: string;
  branchId: ID;
  branchName?: string;
  fieldAgentId: ID;
  agentName?: string;
  /** DATE-only, Asia/Kolkata. The server's date, never the device's. */
  businessDate: string;
  /** Snapshotted at submit. What the agent was holding when they declared it. */
  expectedCashPaise: PaiseString;
  handedOverCashPaise: PaiseString;
  /** What the branch actually counted. Absent until received. */
  receivedCashPaise?: PaiseString;
  /**
   * `received - handedOver`, and **signed**.
   *
   * One of the two signed money fields in the codebase (the other is
   * `GeneralLedgerRow`'s balance). A difference is inherently directional, and
   * an unsigned amount plus a side discriminator would make every consumer
   * branch before rendering.
   */
  differencePaise: PaiseString;
  status: CashHandoverStatus;
  receivedBy?: ID;
  receivedByName?: string;
  receivedAt?: string;
  createdAt: string;
  /** The concurrency token. Echo it back on submit, receive and reverse. */
  version: string;
}

/**
 * A handover in full, including the collections whose cash it carries.
 *
 * `collections` is the custody trail Rule 23 asks for, and it is a real foreign
 * key rather than a report: each row's `custodyHandoverId` points here. That is
 * also what makes concurrent handovers unable to double-count the same cash —
 * claiming a collection row is an exclusive act.
 */
export interface CashHandoverDetail extends CashHandoverSummary {
  notes?: string;
  acknowledgmentReference?: string;
  journalEntryId?: ID;
  collections: FieldCollectionSummary[];
  reversalOfHandoverId?: ID;
  reversedByHandoverId?: ID;
  reversalReason?: string;
  reversedAt?: string;
  reversedBy?: ID;
  createdBy: ID;
  /** Set once a reconciliation has closed over this handover. */
  reconciliationId?: ID;
  reconciliationNumber?: string;
}

export interface CashHandoverListResult {
  items: CashHandoverSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type CashHandoverBlockerKey =
  | "NO_CASH_IN_HAND"
  | "AMOUNT_EXCEEDS_BALANCE"
  | "AMOUNT_NOT_A_PREFIX"
  | "HANDOVER_ALREADY_OPEN"
  | "BRANCH_INACTIVE"
  | "ACCOUNT_INACTIVE";

export interface CashHandoverBlocker {
  key: CashHandoverBlockerKey;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Whether an agent can hand over cash right now, and what of.
 *
 * Advisory, in the same way `CollectionReadiness` is: the same checks run
 * authoritatively inside the handover transaction against a re-derived balance.
 * This exists so the form can refuse early and explain why.
 *
 * `handoverableAmounts` is the running prefix-sum of `unclaimedCollections` —
 * the exact set of amounts a handover may name. A partial handover must match
 * one of these, because cash leaves the pool by whole collections being claimed
 * rather than by an amount being subtracted.
 */
export interface CashHandoverReadiness {
  fieldAgentId: ID;
  agentName: string;
  branchId: ID;
  canHandOver: boolean;
  blockers: CashHandoverBlocker[];
  expectedCashPaise: PaiseString;
  unclaimedCollections: FieldCollectionSummary[];
  handoverableAmounts: PaiseString[];
}

export type CashReconciliationStatus =
  "PENDING" | "MATCHED" | "DISCREPANCY_PENDING" | "RESOLVED";

export type CashDiscrepancyType =
  | "SHORTAGE"
  | "EXCESS"
  | "COUNTERFEIT"
  | "DAMAGED_NOTES"
  | "DISPUTED_COLLECTION"
  | "OTHER";

export type CashDiscrepancyResolution =
  | "RECOVERED_FROM_AGENT"
  | "WRITTEN_OFF"
  | "ADJUSTED_NEXT_HANDOVER"
  | "ESCALATED"
  | "NO_ACTION";

/** A reconciliation as it appears in a list. */
export interface CashReconciliationSummary {
  reconciliationId: ID;
  reconciliationNumber: string;
  branchId: ID;
  branchName?: string;
  fieldAgentId: ID;
  agentName?: string;
  handoverId?: ID;
  handoverNumber?: string;
  /** DATE-only, Asia/Kolkata. */
  businessDate: string;
  expectedCashPaise: PaiseString;
  actualCashPaise: PaiseString;
  /** `actual - expected`, signed. Negative is a shortage. */
  differencePaise: PaiseString;
  status: CashReconciliationStatus;
  discrepancyType?: CashDiscrepancyType;
  createdAt: string;
  /** The concurrency token. Echo it back on resolve. */
  version: string;
}

/**
 * A reconciliation in full, including how any discrepancy was resolved.
 *
 * Resolving writes no journal. Rule 36 forbids an approval silently changing
 * historical amounts, and Scenario 29 says any accounting adjustment "follows a
 * separately authorized financial rule" — Module 14's manual journal is that
 * rule. `approvalReference` is where its entry number is recorded, which is the
 * link between the two without this module posting anything itself.
 */
export interface CashReconciliationDetail extends CashReconciliationSummary {
  discrepancyReason?: string;
  resolutionAction?: CashDiscrepancyResolution;
  resolutionNotes?: string;
  /** A Module 14 journal entry number, when the resolution needed one. */
  approvalReference?: string;
  resolvedBy?: ID;
  resolvedByName?: string;
  resolvedAt?: string;
  approvedBy?: ID;
  notes?: string;
  createdBy: ID;
}

export interface CashReconciliationListResult {
  items: CashReconciliationSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type SyncItemStatus =
  "QUEUED" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";

/**
 * The server's record that a device is holding captured work.
 *
 * This is not the work itself — a queued collection syncs through the sync
 * endpoint. This exists so an operator can see what has not flushed and drive a
 * retry, which is what gives Scenario 16's "the conflict is audit logged" a
 * queryable row rather than only an audit line.
 */
export interface SyncQueueItem {
  syncItemId: ID;
  clientTransactionId: string;
  userId: ID;
  userName?: string;
  entityType: string;
  entityId?: ID;
  status: SyncItemStatus;
  attemptCount: number;
  lastError?: string;
  queuedAt: string;
  syncedAt?: string;
}

export interface SyncQueueListResult {
  items: SyncQueueItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================================================
// Module 14 — Accounting & Ledger
//
// Every money field is a `PaiseString`. Balances carry a sign, which is the one
// place in this file where a `PaiseString` may begin with `-`: a general-ledger
// running balance and a trial-balance figure are both differences, and the
// alternative — an unsigned amount plus a side discriminator — would make every
// consumer branch before it could render a number.
// ============================================================================

export type AccountType =
  "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export type NormalBalance = "DEBIT" | "CREDIT";

export type AccountBranchScope = "ORGANIZATION" | "BRANCH";

export type JournalEntryStatus = "DRAFT" | "POSTED" | "REVERSED";

export interface AccountSummary {
  accountId: ID;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  status: "ACTIVE" | "INACTIVE";
  /** Whether any journal line may reference this account. */
  isPostable: boolean;
  /** Whether a hand-authored journal may reference it. Narrower than isPostable. */
  isManualPostingAllowed: boolean;
  isControlAccount: boolean;
  parentAccountId?: ID;
  parentAccountCode?: string;
  accountCategory?: string;
  branchScope: AccountBranchScope;
  /** The optimistic-concurrency token: the record's ISO `updatedAt`. */
  version: string;
}

export interface AccountDetail extends AccountSummary {
  description?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  createdAt: string;
  /**
   * How many posted journal lines reference this account.
   *
   * Non-zero freezes the account's identity — code, type and normal balance —
   * because changing any of them would retroactively alter what an already
   * posted line means.
   */
  postedLineCount: number;
  childAccountCount: number;
  /**
   * The server's verdicts, so the UI never re-derives a lifecycle rule.
   *
   * A client that computed `canDelete` itself would have to know about posted
   * lines, child accounts and downstream references, and would get it wrong the
   * first time any of those changed.
   */
  canDelete: boolean;
  canEditIdentity: boolean;
}

export interface AccountTreeNode extends AccountSummary {
  children: AccountTreeNode[];
}

/**
 * One line as a form submits it, before the server assigns it an id or a
 * number.
 *
 * Distinct from `JournalLineView`, which is a line the ledger already holds.
 * The builder edits these; the detail screens render those.
 */
export interface JournalLineInput {
  accountId: ID;
  debitPaise: PaiseString;
  creditPaise: PaiseString;
  description?: string;
}

export interface JournalLineView {
  journalLineId: ID;
  lineNumber: number;
  accountId: ID;
  accountCode: string;
  accountName: string;
  debitPaise: PaiseString;
  creditPaise: PaiseString;
  description?: string;
  /** PENALTY | INTEREST | PRINCIPAL | FEE | FUNDING | MANUAL. */
  sourceComponent?: string;
}

export interface JournalSummary {
  journalEntryId: ID;
  entryNumber: string;
  entryDate: string;
  entryType: string;
  status: JournalEntryStatus;
  description?: string;
  sourceType?: string;
  sourceId?: ID;
  branchId?: ID;
  branchName?: string;
  totalDebitPaise: PaiseString;
  totalCreditPaise: PaiseString;
  balanced: boolean;
  /** Absent while the entry is a DRAFT. */
  postedAt?: string;
  version: string;
}

export interface JournalDetail extends JournalSummary {
  lines: JournalLineView[];
  createdBy: ID;
  createdByName?: string;
  postedBy?: ID;
  postedByName?: string;
  createdAt: string;
  /** Set on a reversal entry: the entry this one reverses. */
  originalJournalEntryId?: ID;
  originalEntryNumber?: string;
  /** Set on a reversed entry: the reversal that unwound it. */
  reversalJournalEntryId?: ID;
  reversalEntryNumber?: string;
  reversalReason?: string;
  adjustmentReason?: string;
  approvalReference?: string;
  /** Server verdicts, for the same reason as `AccountDetail.canDelete`. */
  canEdit: boolean;
  canDelete: boolean;
  canPost: boolean;
  canReverse: boolean;
}

export interface JournalIssue {
  code: string;
  message: string;
  /** 1-indexed, matching the line numbers the UI shows. */
  lineNumber?: number;
}

/**
 * The result of checking a draft without saving it.
 *
 * Totals come from the server so the browser never marks its own homework —
 * the same rule `LedgerPanel` already follows for a posted entry.
 */
export interface JournalValidation {
  valid: boolean;
  totalDebitPaise: PaiseString;
  totalCreditPaise: PaiseString;
  balanced: boolean;
  issues: JournalIssue[];
}

/** Where a posted journal came from, without exposing the source record itself. */
export interface JournalSourceRef {
  sourceModule: string;
  sourceId?: ID;
  sourceReference?: string;
  /** False when the caller lacks permission to open the source transaction. */
  reachable: boolean;
}

export interface GeneralLedgerRow {
  journalLineId: ID;
  journalEntryId: ID;
  entryNumber: string;
  entryDate: string;
  description?: string;
  sourceType?: string;
  sourceId?: ID;
  debitPaise: PaiseString;
  creditPaise: PaiseString;
  /** Signed, and computed server-side. May begin with `-`. */
  runningBalancePaise: PaiseString;
  postedAt: string;
}

export interface GeneralLedgerPage {
  accountId: ID;
  accountCode: string;
  accountName: string;
  normalBalance: NormalBalance;
  fromDate?: string;
  toDate?: string;
  /** Signed. The account's balance immediately before `fromDate`. */
  openingBalancePaise: PaiseString;
  closingBalancePaise: PaiseString;
  totalDebitPaise: PaiseString;
  totalCreditPaise: PaiseString;
  rows: GeneralLedgerRow[];
  total: number;
}

export interface TrialBalanceRow {
  accountId: ID;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  debitPaise: PaiseString;
  creditPaise: PaiseString;
  /** Unsigned magnitude; `balanceSide` says which column it belongs in. */
  balancePaise: PaiseString;
  balanceSide: NormalBalance;
}

export interface TrialBalance {
  asOfDate: string;
  rows: TrialBalanceRow[];
  totalDebitPaise: PaiseString;
  totalCreditPaise: PaiseString;
  /** False here means the ledger itself is broken, not that a form is invalid. */
  balanced: boolean;
}

export interface ReconciliationFinding {
  kind: "MISSING_JOURNAL" | "DUPLICATE_JOURNAL" | "UNBALANCED_JOURNAL";
  sourceModule: string;
  sourceId: ID;
  sourceReference?: string;
  journalEntryIds: ID[];
  occurredOn: string;
  detail: string;
}

/**
 * What reconciliation found. It flags; it never repairs.
 *
 * An empty report is the expected result. A non-empty one is a controlled
 * investigation, which is why nothing here offers a "fix" action: silently
 * fabricating a balancing entry is precisely the failure this detects.
 */
export interface ReconciliationReport {
  checkedAt: string;
  fromDate: string;
  toDate: string;
  missingJournals: ReconciliationFinding[];
  duplicateJournals: ReconciliationFinding[];
  unbalancedJournals: ReconciliationFinding[];
  summary: {
    sourceEventsChecked: number;
    journalsChecked: number;
    findingCount: number;
  };
}

export interface AccountListResult {
  items: AccountSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface JournalListResult {
  items: JournalSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Module 13 — Overdue & Recovery
// ---------------------------------------------------------------------------

export type DelinquencyBucket =
  | "CURRENT"
  | "DPD_1_30"
  | "DPD_31_60"
  | "DPD_61_90"
  | "DPD_91_180"
  | "DPD_180_PLUS";

export type NpaStatus =
  "STANDARD" | "SPECIAL_MENTION" | "SUB_STANDARD" | "DOUBTFUL" | "LOSS";

export type RecoveryCaseStatus =
  | "OPEN"
  | "FIELD_ASSIGNED"
  | "FIELD_VISIT"
  | "BRANCH_REVIEW"
  | "LEGAL_NOTICE"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "LEGAL_ACTION"
  | "CLOSED";

export type RecoveryActionType =
  | "REMINDER"
  | "PHONE_CALL"
  | "FIELD_ASSIGNMENT"
  | "FIELD_VISIT"
  | "BRANCH_REVIEW"
  | "LEGAL_NOTICE"
  | "SETTLEMENT"
  | "LEGAL_ACTION";

export type RecoveryOutcome =
  | "CONTACTED_PROMISED"
  | "CONTACTED_REFUSED"
  | "CONTACTED_DISPUTED"
  | "CONTACTED_PARTIAL_PAYMENT"
  | "NO_ANSWER"
  | "UNREACHABLE"
  | "WRONG_CONTACT"
  | "CUSTOMER_UNAVAILABLE"
  | "ESCALATION_REQUIRED"
  | "RESOLVED";

export type RecoveryPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RecoveryResolutionType =
  | "RECOVERED_FULL"
  | "RECOVERED_PARTIAL"
  | "SETTLED"
  | "WRITTEN_OFF"
  | "RESTRUCTURED"
  | "LEGAL_ACTION"
  | "NOT_RECOVERABLE";

export type SettlementStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

export type LegalNoticeStatus =
  "ISSUED" | "ACTIVE" | "EXPIRED" | "SETTLED" | "LEGAL_ACTION";

export type PenaltyStatus =
  "ASSESSED" | "PARTIALLY_PAID" | "PAID" | "ADJUSTED" | "WAIVED" | "CANCELLED";

/**
 * One loan's overdue position.
 *
 * **Every field here is derived, none is stored.** Days past due, the bucket,
 * the classification and the four component totals are computed on each read
 * from the authoritative schedule, the posted payments and the Asia/Kolkata
 * business date (Rule 4). There is no overdue table behind this shape,
 * deliberately: a stored copy would drift from the schedule screen the moment a
 * payment landed.
 *
 * There is consequently no `version` either — nothing here can be edited, so
 * nothing needs a concurrency token.
 */
export interface OverdueSummary {
  loanId: ID;
  loanNumber: string;
  customerId: ID;
  customerName: string;
  branchId: ID;
  branchName?: string;
  loanStatus: LoanStatus;
  /** DATE-only. The earliest installment still owing anything. */
  oldestDueDate?: string;
  daysPastDue: number;
  bucket: DelinquencyBucket;
  /**
   * What the ageing *supports*, which is not the same as what the loan is.
   *
   * Rule 29 requires NPA classification be authorized, so this is the derived
   * eligibility and `RecoveryCaseSummary.npaStatus` is the committed one. A
   * consumer that rendered this as the loan's classification would be showing a
   * decision nobody made.
   */
  npaEligibility: NpaStatus;
  overduePrincipalPaise: PaiseString;
  overdueInterestPaise: PaiseString;
  overduePenaltyPaise: PaiseString;
  overdueFeesPaise: PaiseString;
  /** The sum of the four above — the source's money identity. */
  totalOverduePaise: PaiseString;
  /** The open case, when one exists. Absent means nobody is working this debt. */
  recoveryCaseId?: ID;
  recoveryCaseStatus?: RecoveryCaseStatus;
}

/** One overdue installment, as the detail screen lists them. */
export interface OverdueInstallment {
  emiId: ID;
  installmentNumber: number;
  dueDate: string;
  daysPastDue: number;
  totalDuePaise: PaiseString;
  paidAmountPaise: PaiseString;
  outstandingAmountPaise: PaiseString;
  penaltyOutstandingPaise: PaiseString;
}

export interface OverdueDetail extends OverdueSummary {
  installments: OverdueInstallment[];
  penalties: PenaltySummary[];
  /** The loan's whole outstanding balance, not only the overdue part. */
  totalOutstandingPaise: PaiseString;
}

export interface OverdueListResult {
  items: OverdueSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * An assessed penalty.
 *
 * `amountPaise` is the contractual figure and is never rewritten by a payment,
 * mirroring `Emi.totalDuePaise` (Rule 9). `calculationSnapshot` is what makes
 * the charge replayable: it records what the calculation actually saw, so a
 * posting can be defended years later against configuration that has since
 * changed (Rule 12).
 */
export interface PenaltySummary {
  penaltyId: ID;
  loanId: ID;
  emiId?: ID;
  assessedDate: string;
  amountPaise: PaiseString;
  paidAmountPaise: PaiseString;
  outstandingAmountPaise: PaiseString;
  status: PenaltyStatus;
  calculationType: string;
  /** The inputs the assessment used. Opaque to the client; rendered as detail. */
  calculationSnapshot: Record<string, unknown>;
  createdAt: string;
}

/** One entry in a case's assignment history (Rule 25, Scenario 10). */
export interface RecoveryAssignmentRecord {
  assignmentId: ID;
  fromUserId?: ID;
  fromUserName?: string;
  toUserId: ID;
  toUserName: string;
  assignedBy: ID;
  assignedByName?: string;
  assignedAt: string;
  reason?: string;
}

/**
 * One recorded recovery activity.
 *
 * `finalizedAt` is the freeze: absent means still editable (Scenario 31),
 * present means the outcome is history and a correction must be a follow-up
 * action rather than a rewrite (Scenario 32).
 */
export interface RecoveryActionRecord {
  recoveryActionId: ID;
  recoveryCaseId: ID;
  actionType: RecoveryActionType;
  actionDate?: string;
  outcome?: RecoveryOutcome;
  performedBy: ID;
  performedByName?: string;
  notes?: string;
  nextFollowUpDate?: string;
  promiseToPayDate?: string;
  promiseToPayAmountPaise?: PaiseString;
  /**
   * Whether the promised date has passed with no authoritative payment
   * (Scenario 16). Derived on read, like everything else time-dependent here.
   */
  promiseMissed?: boolean;
  finalizedAt?: string;
  offlineActivityUuid?: ID;
  deviceId?: string;
  gpsCaptureStatus?: GpsVerificationStatus;
  gpsCheckInId?: ID;
  customerAckReference?: string;
  createdAt: string;
  /** `updatedAt`, the optimistic-concurrency token. */
  version: string;
}

export interface LegalNoticeRecord {
  legalNoticeId: ID;
  recoveryCaseId: ID;
  noticeDate: string;
  noticePeriodDays: number;
  expiryDate: string;
  status: LegalNoticeStatus;
  noticeReference?: string;
  documentRef?: string;
  issuedBy?: ID;
  issuedByName?: string;
  createdAt: string;
}

/**
 * A settlement.
 *
 * `waivedAmountPaise` is what is forgiven; `settlementAmountPaise` is what the
 * borrower pays. The two add to `outstandingBeforePaise`, held by a database
 * CHECK so the three can never disagree.
 */
export interface SettlementRecord {
  settlementId: ID;
  recoveryCaseId: ID;
  loanId: ID;
  settlementAmountPaise: PaiseString;
  outstandingBeforePaise?: PaiseString;
  waivedAmountPaise?: PaiseString;
  status: SettlementStatus;
  agreedDate?: string;
  completedDate?: string;
  approvedBy?: ID;
  approvedByName?: string;
  approvedAt?: string;
  approvalReference?: string;
  reason?: string;
  journalEntryId?: ID;
  createdBy?: ID;
  createdAt: string;
  version: string;
}

export interface RecoveryCaseSummary {
  recoveryCaseId: ID;
  caseNumber?: string;
  loanId: ID;
  loanNumber: string;
  customerId: ID;
  customerName: string;
  branchId: ID;
  branchName?: string;
  status: RecoveryCaseStatus;
  priority: RecoveryPriority;
  /** The committed classification, unlike `OverdueSummary.npaEligibility`. */
  npaStatus: NpaStatus;
  openedDate: string;
  closedDate?: string;
  assignedAgentId?: ID;
  assignedAgentName?: string;
  assignmentDate?: string;
  /** Derived, for the worklist. The same figure the overdue book shows. */
  totalOverduePaise: PaiseString;
  daysPastDue: number;
  bucket: DelinquencyBucket;
  createdAt: string;
  /** `updatedAt`, the optimistic-concurrency token (Scenarios 12, 52). */
  version: string;
}

export interface RecoveryCaseDetail extends RecoveryCaseSummary {
  loanStatus: LoanStatus;
  /** Chronological, oldest first. Preserved across reassignment (Rule 25). */
  assignments: RecoveryAssignmentRecord[];
  actions: RecoveryActionRecord[];
  legalNotices: LegalNoticeRecord[];
  settlements: SettlementRecord[];
  penalties: PenaltySummary[];
  overdue: OverdueDetail;
  resolutionType?: RecoveryResolutionType;
  closureReason?: string;
  closedBy?: ID;
  closedByName?: string;
  outstandingBeforePaise?: PaiseString;
  recoveredAmountPaise?: PaiseString;
  remainingOutstandingPaise?: PaiseString;
  approvalReference?: string;
  escalatedAt?: string;
  escalationReason?: string;
  createdBy?: ID;
}

export interface RecoveryCaseListResult {
  items: RecoveryCaseSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Why a recovery action is refused, in the shape Module 11 already uses.
 *
 * A list rather than a single reason: a written-off loan whose case is closed
 * fails two ways at once, and reporting one would send the user round a loop
 * fixing them one at a time.
 */
export interface RecoveryBlocker {
  key: string;
  reason: string;
}

// ============================================================================
// Module 15 — Reports & Analytics
//
// Every figure here is a read-only projection of another module's authoritative
// data. Nothing in this section is written back: Rules 5, 6 and 17 make reports
// views rather than records, and Scenario 46 makes editing a reported value a
// refusal rather than an update.
//
// Three conventions run through all of it:
//
//  * Money is a `PaiseString`, aggregated as BigInt server-side and serialised
//    as a decimal string. A report total above ~90,000 crore in paise exceeds
//    `Number.MAX_SAFE_INTEGER`, so it never becomes a `number`.
//  * Derived state — overdue status, days past due, delinquency bucket, NPA —
//    is computed by the same `@lms/emi` helpers the owning module uses. A
//    report that classified a loan itself would be a second, disagreeing
//    source of truth (Rules 13, 14).
//  * Every response carries `meta`, which names the date basis actually
//    applied and when the data was read. Rule 36 forbids presenting aggregated
//    data as real-time without a freshness indicator.
// ============================================================================

export type ReportDateBasis =
  | "APPLICATION_DATE"
  | "DISBURSAL_DATE"
  | "DUE_DATE"
  | "COLLECTION_DATE"
  | "ACCOUNTING_DATE"
  | "BUSINESS_DATE";

export type ReportCategory =
  | "DASHBOARD"
  | "PORTFOLIO"
  | "APPLICATIONS"
  | "DISBURSALS"
  | "COLLECTIONS"
  | "FIELD_COLLECTIONS"
  | "OVERDUE_RECOVERY"
  | "FINANCIAL";

export type ReportExportFormat = "CSV" | "PDF";

export type ReportVisibility = "PRIVATE" | "SHARED";

/**
 * What every report response says about itself.
 *
 * `dateBasis` is the basis the server actually applied, not the one requested —
 * they differ when a category fixes its basis, and echoing the request would
 * hide that (Rule 10, Scenario 12). `branchId` is likewise the scope enforced,
 * which is how a caller learns their requested branch was narrowed rather than
 * silently obeyed (Scenario 11).
 */
export interface ReportMeta {
  category: ReportCategory;
  dateBasis: ReportDateBasis;
  fromDate: string;
  toDate: string;
  /** Null means organization-wide, which only an unscoped caller can obtain. */
  branchId: ID | null;
  branchName?: string;
  /**
   * When the underlying data was read. Rule 37: freshness must be available
   * wherever data is aggregated. Nothing is cached today, so this is the moment
   * the query ran — honest rather than absent.
   */
  dataFreshAt: string;
  /** True when the caller lacks `reports.export.pii` and columns are masked. */
  piiMasked: boolean;
}

/**
 * The dashboard KPI groups.
 *
 * Grouped rather than flattened because the groups have different date bases:
 * the portfolio figures are as-of-now positions, while the collection figures
 * are bounded by the selected range. Flattening them into one bag of numbers
 * would be exactly the silent mixing Rule 11 prohibits.
 */
export interface PortfolioKpis {
  totalActiveLoans: number;
  totalOutstandingPrincipalPaise: PaiseString;
  totalPortfolioOutstandingPaise: PaiseString;
  loansDisbursed: number;
  disbursedAmountPaise: PaiseString;
}

export interface CollectionKpis {
  collectionDuePaise: PaiseString;
  collectionReceivedPaise: PaiseString;
  /** Basis points of received/due, so the ratio never becomes a float. */
  collectionRateBps: string;
  cashPendingReconciliationPaise: PaiseString;
  reconciledAmountPaise: PaiseString;
}

export interface DelinquencyBucketKpi {
  bucket: string;
  accounts: number;
  amountPaise: PaiseString;
}

export interface DelinquencyKpis {
  overdueAccounts: number;
  overdueAmountPaise: PaiseString;
  oldestDueDate?: string;
  npaCount: number;
  npaOutstandingPaise: PaiseString;
  /** Counts per bucket, from the `delinquencyBucket` helper in `@lms/emi`. */
  buckets: DelinquencyBucketKpi[];
}

export interface RecoveryKpis {
  openCases: number;
  assignedCases: number;
  promiseToPayAmountPaise: PaiseString;
  recoveredAmountPaise: PaiseString;
  escalatedCases: number;
}

export interface ReportDashboard {
  meta: ReportMeta;
  portfolio: PortfolioKpis;
  collections: CollectionKpis;
  delinquency: DelinquencyKpis;
  recovery: RecoveryKpis;
}

export interface PortfolioReportRow {
  loanId: ID;
  loanNumber: string;
  customerId: ID;
  customerName: string;
  branchId: ID;
  branchName: string;
  loanProductName: string;
  status: LoanStatus;
  disbursementDate?: string;
  principalDisbursedPaise: PaiseString;
  outstandingPrincipalPaise: PaiseString;
  outstandingInterestPaise: PaiseString;
  outstandingPenaltyPaise: PaiseString;
  outstandingFeesPaise: PaiseString;
  totalOutstandingPaise: PaiseString;
  oldestUnpaidDueDate?: string;
  daysPastDue: number;
  npaStatus: string;
}

export interface ApplicationReportRow {
  applicationId: ID;
  applicationNumber: string;
  customerId: ID;
  customerName: string;
  branchId: ID;
  branchName: string;
  loanProductName: string;
  applicationDate?: string;
  requestedAmountPaise: PaiseString;
  approvedAmountPaise?: PaiseString;
  status: string;
  currentApprovalStage?: string;
  rejectionReason?: string;
}

export interface DisbursalReportRow {
  disbursementId: ID;
  loanId: ID;
  loanNumber: string;
  customerName: string;
  branchId: ID;
  branchName: string;
  loanProductName: string;
  disbursalDate?: string;
  sanctionedAmountPaise: PaiseString;
  disbursedAmountPaise: PaiseString;
  status: string;
  paymentMode?: string;
  referenceNumber?: string;
}

/**
 * One collection, with its allocation broken out.
 *
 * The four component fields are the authoritative allocation recorded by
 * Module 11, not a re-split of `collectedAmountPaise`. Rule 21 fixes the order
 * penalty then interest then principal then fees, and Rule 22 requires the
 * report to show what was actually allocated — recomputing it here could
 * disagree with the ledger for the same receipt.
 */
export interface CollectionReportRow {
  collectionId: ID;
  receiptNumber?: string;
  loanId: ID;
  loanNumber: string;
  customerName: string;
  branchId: ID;
  branchName: string;
  collectionDate: string;
  paymentMode: string;
  collectedAmountPaise: PaiseString;
  penaltyAllocationPaise: PaiseString;
  interestAllocationPaise: PaiseString;
  principalAllocationPaise: PaiseString;
  feeAllocationPaise: PaiseString;
  status: string;
  /** Present when this row reverses another, or was itself reversed. */
  reversalReference?: string;
  fieldAgentName?: string;
}

export interface FieldCollectionReportRow {
  fieldAgentId: ID;
  fieldAgentName: string;
  branchId: ID;
  branchName: string;
  businessDate: string;
  collectionCount: number;
  cashCollectedPaise: PaiseString;
  cashHandedOverPaise: PaiseString;
  cashPendingPaise: PaiseString;
  shortagePaise: PaiseString;
  excessPaise: PaiseString;
  reconciliationStatus: string;
}

export interface OverdueReportRow {
  loanId: ID;
  loanNumber: string;
  customerName: string;
  branchId: ID;
  branchName: string;
  oldestUnpaidDueDate?: string;
  daysPastDue: number;
  overduePrincipalPaise: PaiseString;
  overdueInterestPaise: PaiseString;
  overduePenaltyPaise: PaiseString;
  overdueFeesPaise: PaiseString;
  totalOverduePaise: PaiseString;
  delinquencyBucket: string;
  npaStatus: string;
  recoveryOfficerName?: string;
  recoveryStatus?: string;
  promiseToPayDate?: string;
  promiseToPayAmountPaise?: PaiseString;
}

/**
 * One posted journal line, flattened for the financial report.
 *
 * Derived from Module 14's `GeneralLedgerRow` rather than from a second
 * aggregation, so the two surfaces cannot disagree (Rule 15, Scenario 27).
 * `runningBalancePaise` is signed and computed server-side for the same reason
 * it is on the ledger: a running balance summed client-side is wrong on every
 * page but the first.
 */
export interface FinancialReportRow {
  journalEntryId: ID;
  journalLineId: ID;
  businessDate: string;
  journalReference: string;
  accountCode: string;
  accountName: string;
  debitPaise: PaiseString;
  creditPaise: PaiseString;
  runningBalancePaise: PaiseString;
  sourceModule?: string;
  sourceTransactionId?: ID;
  reversalReference?: string;
  branchId?: ID;
  branchName?: string;
}

/**
 * The envelope every tabular report returns.
 *
 * `totals` is computed from the whole filtered dataset, not from the page —
 * Rule 35 requires summary figures to represent the same authorized dataset the
 * filters describe, and a page-local total would understate every report longer
 * than one page.
 */
export interface ReportPage<TRow> {
  meta: ReportMeta;
  rows: TRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: Record<string, PaiseString | number>;
}

export type PortfolioReport = ReportPage<PortfolioReportRow>;
export type ApplicationReport = ReportPage<ApplicationReportRow>;
export type DisbursalReport = ReportPage<DisbursalReportRow>;
export type CollectionReport = ReportPage<CollectionReportRow>;
export type FieldCollectionReport = ReportPage<FieldCollectionReportRow>;
export type OverdueReport = ReportPage<OverdueReportRow>;
export type FinancialReport = ReportPage<FinancialReportRow>;

/**
 * A stored filter set.
 *
 * `filters` is the saved request, and it is re-validated against the runner's
 * live authorization every time the report is run rather than trusted from
 * storage: authorization can be reduced after a definition is saved, and
 * Rules 4 and 27 both say the server decides scope at request time.
 */
export interface SavedReportSummary {
  reportDefinitionId: ID;
  code: string;
  name: string;
  category: ReportCategory;
  visibility: ReportVisibility;
  status: "ACTIVE" | "INACTIVE";
  ownerUserId: ID;
  ownerName?: string;
  branchId?: ID;
  branchName?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SavedReportDetail extends SavedReportSummary {
  dateBasis?: ReportDateBasis;
  fromDate?: string;
  toDate?: string;
  filters: Record<string, string | number | boolean | null>;
  createdBy?: ID;
}

export interface SavedReportListResult {
  items: SavedReportSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Why a saved-report action is refused, in the shape Modules 11 and 13 use. */
export interface SavedReportBlocker {
  key: string;
  reason: string;
}

// ============================================================================
// Module 16 — Notifications
// ============================================================================

/**
 * The channels Module 16 delivers on.
 *
 * The database enum also carries `PUSH` and `AUTO_CALL`, kept only because
 * dropping a Postgres enum value rewrites the type. Neither is reachable.
 */
export type NotificationChannel = "IN_APP" | "EMAIL" | "SMS";

/**
 * The logical lifecycle of one notification to one recipient.
 *
 * Deliberately stops at `SENT`. Whether an external provider delivered is a
 * per-attempt fact on `DeliveryAttempt.status`, because one logical
 * notification can have several attempts with different outcomes — collapsing
 * them into a logical `DELIVERED` is the false claim Rule 17 forbids.
 */
export type NotificationStatus =
  | "CREATED"
  | "QUEUED"
  | "PROCESSING"
  | "SENT"
  | "FAILED"
  | "RETRYING"
  | "SUPPRESSED"
  | "ARCHIVED";

/**
 * The canonical outcome of one delivery attempt.
 *
 * `ACCEPTED_BY_PROVIDER` is the terminal success for EMAIL and SMS: an SMTP
 * `250 OK` and a gateway `queued` both mean the provider took custody, not that
 * anyone received anything (Rule 17, Scenario 27). `DELIVERED` is reachable
 * only for IN_APP, where the LMS itself is the delivery.
 */
export type DeliveryStatus =
  | "PENDING"
  | "ACCEPTED_BY_PROVIDER"
  | "DELIVERED"
  | "FAILED"
  | "RETRY_SCHEDULED"
  | "PERMANENT_FAILURE";

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type NotificationTemplateStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export type RecipientStrategy =
  | "ROLE"
  | "ASSIGNED_USER"
  | "RECORD_OWNER"
  | "BRANCH_USER_GROUP"
  | "EXPLICIT";

/** The nine preference categories a user toggles. */
export type PreferenceCategory =
  | "APPLICATION"
  | "APPROVAL"
  | "DISBURSAL"
  | "EMI"
  | "COLLECTION"
  | "FIELD_COLLECTION"
  | "OVERDUE"
  | "RECOVERY"
  | "SECURITY";

/**
 * One row in the notification centre.
 *
 * `title` and `message` are the content as it was rendered and frozen at
 * creation, not a live render of the current template (Rule 40, Scenario 8).
 */
export interface NotificationSummary {
  notificationId: ID;
  eventType: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  status: NotificationStatus;
  /** Per-recipient (Rules 51, 52). This row belongs to exactly one user. */
  readStatus: boolean;
  readAt?: string;
  archivedAt?: string;
  isMandatory: boolean;
  sourceModule?: string;
  sourceType?: string;
  sourceId?: ID;
  branchId?: ID;
  branchName?: string;
  createdAt: string;
}

export interface NotificationDetail extends NotificationSummary {
  /** Which template version produced the frozen content above (Rule 39). */
  templateVersion?: number;
  templateCode?: string;
  /** Set only when `status` is SUPPRESSED (Scenario 20). */
  suppressionReason?: string;
  recipientRoleSnapshot?: string;
  occurredAt?: string;
  sentAt?: string;
  /** Present only for a caller holding `notifications.deliveries.view`. */
  deliveries?: DeliveryAttempt[];
}

export interface NotificationListResult {
  items: NotificationSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** The badge count, so the bell needs one request rather than two. */
  unreadCount: number;
}

export interface NotificationUnreadCount {
  unreadCount: number;
}

/** One attempt to deliver one notification through one channel (Rule 15). */
export interface DeliveryAttempt {
  deliveryId: ID;
  channel: NotificationChannel;
  attemptNumber: number;
  status: DeliveryStatus;
  provider?: string;
  providerMessageId?: string;
  /** The raw provider status, preserved beside the canonical one (Rule 18). */
  providerStatus?: string;
  failureCode?: string;
  failureReason?: string;
  attemptedAt: string;
  completedAt?: string;
  deliveredAt?: string;
  /** Set only when `status` is RETRY_SCHEDULED. */
  nextRetryAt?: string;
}

/**
 * One row in Delivery Monitoring, which spans recipients rather than one user.
 *
 * `title` and `message` are omitted unless the caller holds
 * `notifications.view` — Rule 55 minimises notification content by permission,
 * not by channel alone.
 */
export interface DeliveryMonitorRow {
  notificationId: ID;
  eventType: string;
  status: NotificationStatus;
  priority: NotificationPriority;
  title?: string;
  message?: string;
  recipientUserId?: ID;
  recipientName?: string;
  branchId?: ID;
  branchName?: string;
  ruleName?: string;
  attemptCount: number;
  lastAttempt?: DeliveryAttempt;
  createdAt: string;
}

export interface DeliveryMonitorResult {
  items: DeliveryMonitorRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationTemplateSummary {
  templateId: ID;
  name: string;
  code: string;
  category: string;
  sourceModule: string;
  eventType: string;
  channel: NotificationChannel;
  status: NotificationTemplateStatus;
  version: number;
  /** A protected system template may be edited but never deleted (Rule 33). */
  isSystem: boolean;
  containsPii: boolean;
  locale: string;
  updatedAt: string;
}

export interface NotificationTemplateDetail
  extends NotificationTemplateSummary {
  subject?: string;
  titleTemplate?: string;
  messageTemplate: string;
  sensitivity: string;
  createdAt: string;
  /** How many rules and notifications reference it, for the delete affordance. */
  ruleCount: number;
  notificationCount: number;
}

export interface NotificationTemplateListResult {
  items: NotificationTemplateSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NotificationEventRuleSummary {
  ruleId: ID;
  name: string;
  eventType: string;
  sourceModule: string;
  sourceTrigger: string;
  recipientStrategy: RecipientStrategy;
  channel: NotificationChannel;
  templateId: ID;
  templateName?: string;
  priority: NotificationPriority;
  /** A mandatory rule ignores personal preferences (Rules 47, 48). */
  isMandatory: boolean;
  isActive: boolean;
  /** Null means organization-wide, not unknown (Rules 34, 41). */
  branchId?: ID;
  branchName?: string;
  version: number;
  updatedAt: string;
}

export interface NotificationEventRuleDetail
  extends NotificationEventRuleSummary {
  recipientRoleCode?: string;
  recipientPermissionCode?: string;
  explicitRecipientUserIds: ID[];
  maxAttempts: number;
  backoffBaseSeconds: number;
  sendImmediately: boolean;
  scheduledOffsetDays?: number;
  createdAt: string;
  notificationCount: number;
}

export interface NotificationEventRuleListResult {
  items: NotificationEventRuleSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * One user's preferences.
 *
 * Carries no `userId`: the route it is read from and written to has no slot for
 * one, which is what makes Scenario 19 hold structurally (Rules 49, 50).
 */
export interface NotificationPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  eventPreferences: Partial<Record<PreferenceCategory, boolean>>;
  /** Rules 65, 66: the version to send back on update, for conflict detection. */
  version: number;
  updatedAt: string;
}

/**
 * A rejected preference update, carrying the current server state.
 *
 * Returning the state rather than a bare error is what lets a client that was
 * behind reconcile rather than guess (Scenarios 21, 51).
 */
export interface NotificationPreferenceConflict {
  message: string;
  current: NotificationPreferences;
}

/** Why a notification action is refused, in the Module 11/13/15 shape. */
export interface NotificationBlocker {
  key: string;
  reason: string;
}

// ============================================================================
// Module 17 — Settings, Audit & Maintenance
// ============================================================================

/**
 * A configured setting.
 *
 * `value` is `unknown` because the registry in `@lms/validation` decides the
 * shape per code — typing it here would mean maintaining the same union twice,
 * and the looser of the two would win.
 *
 * `isValueMasked` is why `value` cannot be trusted as the stored value: for a
 * protected setting read without `settings.protected.manage`, it is a mask
 * rather than the real value (Scenario 2). A UI that shows `value` in an edit
 * field without checking this flag would save the mask over the real setting.
 */
export interface SettingSummary {
  settingId: ID;
  branchId: ID | null;
  settingCode: string;
  name: string;
  description: string;
  category: string;
  valueType: string;
  value: unknown;
  isValueMasked: boolean;
  status: string;
  version: number;
  isProtected: boolean;
  /** From the registry, never a column — see the registry file header. */
  requiresApproval: boolean;
  updatedAt: string;
}

export interface SettingDetail extends SettingSummary {
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/** One entry of the setting registry, for rendering the "add" form. */
export interface SettingCatalogEntry {
  code: string;
  name: string;
  description: string;
  category: string;
  scope: string;
  valueType: string;
  isProtected: boolean;
  requiresApproval: boolean;
}

/**
 * A maker-checker configuration change.
 *
 * `baseVersion` is the version the proposal was built against and is re-checked
 * at apply time: an approval arriving after the setting moved fails the request
 * rather than overwriting the newer value (Scenario 63).
 */
export interface SettingChangeSummary {
  changeRequestId: ID;
  changeRequestNumber: string;
  branchId: ID | null;
  settingCode: string;
  settingName: string;
  requestedValue: unknown;
  baseVersion: number;
  resultVersion: number | null;
  changeReason: string;
  status: string;
  requestedBy: ID;
  submittedAt: string;
}

export interface SettingChangeDetail extends SettingChangeSummary {
  approvedBy: ID | null;
  approvedAt: string | null;
  rejectedBy: ID | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  appliedAt: string | null;
  failureReason: string | null;
}

export interface CalendarHolidayDetail {
  holidayId: ID;
  holidayDate: string;
  name: string;
}

/**
 * The business calendar for a scope.
 *
 * `currentBusinessDate` is DERIVED from the Asia/Kolkata clock on every read,
 * never stored: a stored value is a second source of truth that a missed EOD
 * leaves permanently wrong (Rule 65, Scenario 23).
 */
export interface BusinessCalendarDetail {
  calendarId: ID;
  branchId: ID | null;
  name: string;
  timezone: string;
  /** ISO weekday numbers: 1 = Monday .. 7 = Sunday. */
  workingDays: number[];
  eodWindowStart: string | null;
  eodWindowEnd: string | null;
  allowControlledRerun: boolean;
  status: string;
  version: number;
  holidays: CalendarHolidayDetail[];
  currentBusinessDate: string;
  isWorkingDayToday: boolean;
}

export interface MaintenanceStepDetail {
  jobStepId: ID;
  stepCode: string;
  sequence: number;
  status: string;
  processedCount: number;
  failureCode: string | null;
  failureSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * One maintenance run.
 *
 * `executionKey` is the duplicate-prevention identity — `{jobType}:{branch ??
 * ORG}:{businessDate}` — and deliberately excludes the trigger type so a
 * scheduled and a manual run for the same scope collide (Scenario 66).
 *
 * `isFailureRedacted` says the failure fields were withheld by permission
 * rather than absent (Scenario 27): a UI showing "no failure detail" when the
 * reader simply may not see it would misreport a failed run as unexplained.
 */
export interface MaintenanceJobSummary {
  jobRunId: ID;
  branchId: ID | null;
  jobType: string;
  businessDate: string | null;
  triggerType: string;
  executionKey: string;
  status: string;
  attemptNumber: number;
  startedAt: string | null;
  completedAt: string | null;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  failureCode: string | null;
  failureSummary: string | null;
  retryable: boolean;
  /** Null for a SCHEDULED run — there is no human actor (Rule 63). */
  createdBy: ID | null;
  createdAt: string;
  isFailureRedacted: boolean;
}

export interface MaintenanceJobDetail extends MaintenanceJobSummary {
  steps: MaintenanceStepDetail[];
}

/**
 * Maintenance-mode state for an organization or one branch.
 *
 * `allowedPermissions` is an exemption for callers who are ALREADY authorized,
 * never a grant: the guard runs after authorization, so nothing here can widen
 * access (Rule 78, Scenario 33).
 */
export interface MaintenanceModeDetail {
  maintenanceModeId: ID;
  branchId: ID | null;
  enabled: boolean;
  reason: string;
  enabledBy: ID | null;
  enabledAt: string | null;
  expectedEndAt: string | null;
  allowedPermissions: string[];
  blockedOperations: string[];
  userMessage: string | null;
  version: number;
}

/** One audit event, as the list renders it. */
export interface AuditEventSummary {
  auditId: ID;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: ID | null;
  branchId: ID | null;
  actorUserId: ID | null;
  actorName: string | null;
}

/**
 * One audit event with its change detail.
 *
 * `isRedacted` marks before/after values withheld by permission rather than
 * absent (Scenario 39). Note the trail is append-only at the database level —
 * there is deliberately no update or delete counterpart to this type.
 */
export interface AuditEventDetail extends AuditEventSummary {
  requestId: ID | null;
  ipAddress: string | null;
  userAgent: string | null;
  oldData: unknown;
  newData: unknown;
  metadata: unknown;
  isRedacted: boolean;
}

export interface AuditEventListResult {
  items: AuditEventSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/* -------------------------------------------------------------------------- */
/* Module 17 — Data retention & archival                                      */
/* -------------------------------------------------------------------------- */

/** What a retention policy governs. Mirrors `RetentionRecordCategory`. */
export type RetentionRecordCategory =
  | "AUDIT_LOG"
  | "LEDGER_ENTRY"
  | "JOURNAL_ENTRY"
  | "NOTIFICATION_LOG"
  | "MAINTENANCE_JOB"
  | "USER_SESSION"
  | "REPORT_RUN";

/**
 * A data retention / archival policy (Scenarios 55-58).
 *
 * `immutableEvidence` is derived from the category by the API and is never
 * client-supplied — see the service comment. It is present here so a screen can
 * explain why a purge schedule is unavailable, never so a form can set it.
 */
export interface RetentionPolicyDetail {
  retentionPolicyId: ID;
  name: string;
  recordCategory: RetentionRecordCategory;
  retentionPeriodDays: number;
  /** Null = never archived, which is not the same as "archive immediately". */
  archiveAfterDays: number | null;
  /** Null = never purged. Always null for immutable evidence (Rule 76). */
  purgeAfterDays: number | null;
  immutableEvidence: boolean;
  legalHoldSupported: boolean;
  status: "ACTIVE" | "INACTIVE";
  /** Null until the policy has governed real processing (Scenario 56). */
  referencedAt: string | null;
  /** Whether deletion is available, so a screen need not re-derive the rule. */
  deletable: boolean;
  version: number;
  updatedAt: string;
}

/**
 * One setting inside a configuration document (Scenarios 59-62).
 *
 * `version` is what makes Scenario 61 possible: an entry carrying a version
 * older than the server's is a conflict, not an overwrite. An entry with no
 * version cannot prove it knew the current value, so it is create-only.
 */
export interface ExportedSetting {
  settingCode: string;
  branchId: ID | null;
  value: unknown;
  version: number;
  /** True when the value was withheld because the caller may not read it. */
  isValueMasked: boolean;
  /**
   * Import refuses an approval-gated code: it must go through maker-checker so
   * a second administrator approves it (Scenario 9). Exported anyway, because a
   * document that omitted it would misdescribe the configuration.
   */
  requiresApproval: boolean;
}

export interface ConfigurationExport {
  orgCode: string;
  exportedAt: string;
  /** Bumped only for a breaking change to this document's shape. */
  schemaVersion: 1;
  settings: ExportedSetting[];
}

/** Outcome of an import. `applied` is 0 for a dry run. */
export interface ConfigurationImportResult {
  applied: number;
  created: number;
  updated: number;
  /** Entries whose value already matched, so nothing was written. */
  unchanged: number;
  dryRun: boolean;
}

/* ------------------------------------------------------------------------- *
 * Module 18 — Dashboard & Home
 *
 * The operational home screen. It owns no records: every figure below is the
 * owning module's own arithmetic, reached through a shared provider rather than
 * restated here, so a dashboard number cannot disagree with the screen a user
 * drills into (Rule 1, Scenario 3).
 *
 * Mirrors `DASHBOARD_WIDGET_CODE`, `DASHBOARD_WIDGET_STATUS`,
 * `DASHBOARD_FRESHNESS` and `DASHBOARD_PERIOD_TYPE` in `@lms/constants`, which
 * carry the reasoning for each value. Declared again here because this package
 * imports nothing.
 * ------------------------------------------------------------------------- */

export type DashboardWidgetCode =
  | "LOAN_SUMMARY"
  | "COLLECTION_SUMMARY"
  | "OVERDUE_RECOVERY"
  | "CASH_SUMMARY"
  | "OPERATIONAL_ALERTS"
  | "QUICK_ACTIONS"
  | "RECENT_ACTIVITY";

export type DashboardWidgetStatus =
  | "AVAILABLE"
  | "NO_DATA"
  | "FAILED"
  | "STALE";

export type DashboardFreshness = "LIVE" | "STALE" | "UNAVAILABLE";

export type DashboardPeriodType =
  | "TODAY"
  | "THIS_WEEK"
  | "THIS_MONTH"
  | "CUSTOM";

/**
 * Whether a widget describes a position or a span.
 *
 * The period filter is global, but applying it to every widget would be wrong:
 * "what is outstanding" has no date range, and silently filtering it by one
 * would produce a number that means nothing. A widget declares which kind it is
 * and the filter is applied only to `RANGE_BOUNDED`, with `periodNote` telling
 * the reader which happened (Scenario 4).
 */
export type DashboardScopeType = "AS_OF_NOW" | "RANGE_BOUNDED";

/**
 * The organization and branch a dashboard response was computed for.
 *
 * Every field is server-decided. `branchId` is the *resolved* scope, not the
 * requested one — a branch-confined caller who asks for another branch is
 * refused outright rather than quietly given their own (Scenario 7), so a value
 * here is always one the caller was entitled to.
 */
export interface DashboardScope {
  /** Null means every branch in the organization, which only an unscoped caller can obtain. */
  branchId: ID | null;
  branchName?: string;
  /**
   * True when the caller's own scope pins them to one branch. The selector is
   * rendered read-only, and the server refuses a different branch regardless —
   * this field only spares the user a control that could not have worked.
   */
  branchLocked: boolean;
  /**
   * The authoritative business date, Asia/Kolkata, DATE-only (Rules 15-16).
   * Server-derived and never accepted as a parameter: a wrong device clock must
   * not be able to move a borrower into or out of the overdue book.
   */
  businessDate: string;
}

/** What a widget is, and what happened to it on this request. */
export interface DashboardWidgetMeta {
  widgetCode: DashboardWidgetCode;
  title: string;
  scopeType: DashboardScopeType;
  /** Whether the requested period was applied to this widget's query. */
  periodApplied: boolean;
  /** Why it was or was not, in the words shown to the reader as a caption. */
  periodNote: string;
  /** The owning module the figures came from (Rule 8). */
  source: string;
  /** Where the widget's heading navigates. Re-authorized at the destination (Rule 30). */
  drillDownHref: string;
  freshness: DashboardFreshness;
  /** The moment the queries ran (Rule 31). */
  computedAt: string;
  scope: DashboardScope;
  /** Present only on a `RANGE_BOUNDED` widget whose period was applied. */
  fromDate?: string;
  toDate?: string;
}

/**
 * One widget's result.
 *
 * The union is the whole of Scenario 36. `data` exists on the two arms that
 * have a value and on no others, so a `FAILED` widget cannot be read as a zero
 * and a `NO_DATA` widget cannot be read as a failure — a renderer that tries
 * does not compile, rather than producing a plausible wrong number. Rules 34-36
 * are enforced by the shape, not by remembering to check a status field.
 */
export type DashboardWidget<T> =
  | { status: "AVAILABLE"; meta: DashboardWidgetMeta; data: T }
  | {
      status: "STALE";
      meta: DashboardWidgetMeta;
      data: T;
      /** What is known to be behind, so the reader can judge the value. */
      staleReason: string;
    }
  | { status: "NO_DATA"; meta: DashboardWidgetMeta; message: string }
  | {
      status: "FAILED";
      meta: DashboardWidgetMeta;
      errorCode: string;
      message: string;
      /** Whether Retry can succeed. A permission failure never can (Scenario 37). */
      retryable: boolean;
    };

/**
 * What this caller may see, resolved before any widget is fetched.
 *
 * Returned by its own request so the page knows which widgets to ask for and
 * which quick actions to render without first attempting the ones it may not
 * have. Rule 7 still applies: this is the page's shopping list, and each widget
 * re-checks its own permission when it is actually requested.
 */
export interface DashboardLayout {
  scope: DashboardScope;
  /** The branches this caller may switch to. One entry when `branchLocked`. */
  availableBranches: { branchId: ID; name: string }[];
  widgets: Omit<
    DashboardWidgetMeta,
    "freshness" | "computedAt" | "scope" | "fromDate" | "toDate"
  >[];
  /** Only actions whose destination this caller may reach (Rule 26, Scenario 29). */
  quickActions: { code: string; label: string; href: string }[];
}

/** Counts from the authoritative loan and application lifecycle states (Rule 17). */
export interface LoanSummaryWidget {
  totalApplications: number;
  pendingApproval: number;
  approved: number;
  activeLoans: number;
  closedLoans: number;
  overdueLoans: number;
  totalOutstandingPaise: PaiseString;
}

/**
 * Collections over the selected period.
 *
 * `collectedPaise` counts posted records only: a pending, failed or rejected
 * attempt is not a collection (Rule 21, Scenario 15). `collectionRateBps` is
 * integer basis points, never a float — the components stay available so the
 * ratio can be audited rather than trusted (Rule 9).
 */
export interface CollectionSummaryWidget {
  duePaise: PaiseString;
  collectedPaise: PaiseString;
  pendingPaise: PaiseString;
  collectionRateBps: BpsString;
  fieldCollectedPaise: PaiseString;
}

/** Derived from the Overdue & Recovery module, never independently computed (Rule 18). */
export interface OverdueRecoveryWidget {
  overdueAccounts: number;
  overdueAmountPaise: PaiseString;
  /** Display-only summary of authoritative penalty records (Rule 19). */
  penaltyOutstandingPaise: PaiseString;
  escalatedToField: number;
  pendingBranchReview: number;
  /**
   * Null when the caller may not see legal and settlement cases — deliberately
   * distinct from `0`, which would tell an unauthorized reader there are none.
   */
  legalCases: number | null;
}

/**
 * Branch cash for the business date, from the cash and reconciliation source.
 *
 * The dashboard keeps no cash balance of its own (Rule 23). The nullable fields
 * are the ones that exist only once a reconciliation has been performed; null
 * means "not reconciled yet", not "reconciled to zero".
 */
export interface CashSummaryWidget {
  cashInPaise: PaiseString;
  cashOutPaise: PaiseString;
  expectedClosingPaise: PaiseString;
  actualCashPaise: PaiseString | null;
  differencePaise: PaiseString | null;
  reconciliationStatus: string | null;
  dayClosingStatus: string | null;
}

/**
 * One actionable pointer at an authoritative record (Rule 27).
 *
 * An alert is not resolvable here: it disappears when the owning workflow
 * changes the source it counts (Scenario 28). There is no acknowledgement
 * state, because a dismissal that did not survive a reload would be worse than
 * none — see the note on `OperationalAlertsWidget`.
 */
export interface DashboardAlert {
  alertType: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  count: number;
  amountPaise?: PaiseString;
  label: string;
  href: string;
}

/**
 * The alerts this caller is authorized to see.
 *
 * Each row is permission-checked individually and omitted entirely when the
 * caller may not see its source. That is what makes Scenario 27 hold: there is
 * no total to subtract from, so a restricted count cannot be inferred from an
 * aggregate that silently excluded it.
 *
 * // TODO(open-question): Questions 20-21 — whether alerts can be dismissed or
 * // acknowledged, and whether that affects the owning workflow or only the
 * // user's view, is unresolved. Acknowledgement needs a table to persist in;
 * // until there is one, alerts are stateless derived counts and no dismiss
 * // action is offered.
 */
export interface OperationalAlertsWidget {
  alerts: DashboardAlert[];
}

/**
 * One audit event, already scoped and redacted by the audit read path.
 *
 * Nothing here is re-derived: the same query that serves the Audit Trail screen
 * serves this, so the masking that keeps secrets out of the audit log
 * (Scenario 34) applies without being reimplemented.
 */
export interface RecentActivityItem {
  auditId: ID;
  occurredAt: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: ID | null;
  branchId: ID | null;
}

export interface RecentActivityWidget {
  items: RecentActivityItem[];
}

export interface QuickActionsWidget {
  actions: { code: string; label: string; href: string }[];
}
