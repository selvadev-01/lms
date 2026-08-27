import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/** Authentication and session audit actions. */
export const AuditAction = {
  LOGIN_SUCCESS: 'AUTH_LOGIN_SUCCESS',
  LOGIN_FAILURE: 'AUTH_LOGIN_FAILURE',
  LOGIN_DENIED_INACTIVE: 'AUTH_LOGIN_DENIED_INACTIVE',
  LOGIN_DENIED_LOCKED: 'AUTH_LOGIN_DENIED_LOCKED',
  ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'AUTH_ACCOUNT_UNLOCKED',
  LOGOUT: 'AUTH_LOGOUT',
  SESSION_REFRESHED: 'AUTH_SESSION_REFRESHED',
  REFRESH_REUSE_DENIED: 'AUTH_REFRESH_REUSE_DENIED',

  // --- Session management --------------------------------------------------
  //
  // The rejection actions are split by derived state rather than carrying a
  // `reason`, for the same reason the password-change failures are: an expired
  // session is routine, whereas a revoked one being replayed is a security
  // signal worth alerting on by itself (Scenarios 28, 29, 42, 43).
  /** A protected request presented a session that had been logged out. */
  SESSION_REJECTED_LOGGED_OUT: 'AUTH_SESSION_REJECTED_LOGGED_OUT',
  /** Presented a session past its idle or absolute lifetime (Scenarios 9-12). */
  SESSION_REJECTED_EXPIRED: 'AUTH_SESSION_REJECTED_EXPIRED',
  /** Presented a revoked session — possible replay of a captured credential. */
  SESSION_REJECTED_REVOKED: 'AUTH_SESSION_REJECTED_REVOKED',
  /** Presented a session identifier that resolves to nothing (Scenario 28). */
  SESSION_REJECTED_UNKNOWN: 'AUTH_SESSION_REJECTED_UNKNOWN',
  /**
   * The session store could not be reached, so the request was denied rather
   * than allowed (Scenario 36 — fail closed). An operational alarm: sustained
   * occurrences mean the API is down for every authenticated user.
   */
  SESSION_STORE_UNAVAILABLE: 'AUTH_SESSION_STORE_UNAVAILABLE',
  /** The caller listed their own active sessions (Scenario 1). */
  SESSION_VIEWED: 'AUTH_SESSION_VIEWED',
  /** A session was terminated from the Active Sessions screen. */
  SESSION_REVOKED: 'AUTH_SESSION_REVOKED',
  /**
   * A revoke request that changed nothing — the session was unknown, already
   * terminated, or another user's (Scenario 7). Recorded under one action for
   * all three, so the audit log cannot be used to work out which session ids
   * exist, and distinct from SESSION_REVOKED so the trail never claims a
   * termination that did not happen.
   */
  SESSION_REVOKE_NOOP: 'AUTH_SESSION_REVOKE_NOOP',
  /** Every remaining session for the caller was terminated at once. */
  SESSION_REVOKED_ALL: 'AUTH_SESSION_REVOKED_ALL',
  /**
   * A revoke was refused for lack of permission or because the target was out
   * of the caller's scope (Scenarios 23, 24, 44). The target is unchanged.
   */
  SESSION_REVOKE_DENIED: 'AUTH_SESSION_REVOKE_DENIED',

  // --- Password recovery ---------------------------------------------------
  RECOVERY_REQUESTED: 'AUTH_RECOVERY_REQUESTED',
  /**
   * A recovery request that was accepted at the API boundary but produced no
   * OTP — unknown mobile, or an account that is not eligible. Recorded under a
   * single action deliberately: splitting it into "unknown user" and "inactive
   * user" would make the audit log itself an account-enumeration oracle for
   * anyone who can read it (Scenarios 8, 11).
   */
  RECOVERY_REQUEST_IGNORED: 'AUTH_RECOVERY_REQUEST_IGNORED',
  RECOVERY_OTP_VERIFIED: 'AUTH_RECOVERY_OTP_VERIFIED',
  RECOVERY_OTP_FAILED: 'AUTH_RECOVERY_OTP_FAILED',
  RECOVERY_EXPIRED: 'AUTH_RECOVERY_EXPIRED',
  RECOVERY_REPLAY_DENIED: 'AUTH_RECOVERY_REPLAY_DENIED',
  RECOVERY_RATE_LIMITED: 'AUTH_RECOVERY_RATE_LIMITED',
  RECOVERY_SMS_FAILED: 'AUTH_RECOVERY_SMS_FAILED',
  PASSWORD_RESET_COMPLETED: 'AUTH_PASSWORD_RESET_COMPLETED',
  /**
   * A reset rejected by the password policy or the history rule. Distinct from
   * the replay/expiry actions because the authorization was valid — only the
   * submitted password was not, and it remains usable for a retry.
   */
  PASSWORD_RESET_FAILED: 'AUTH_PASSWORD_RESET_FAILED',

  // --- Password change (authenticated) -------------------------------------
  //
  // Four distinct failure actions rather than one carrying a `reason`, because
  // these are materially different security events: a credential denial may be
  // someone probing from a hijacked session, an ineligible denial is an
  // account-control event, a policy failure is ordinary user error, and a
  // revocation failure is an operational alarm. Each needs to be alertable on
  // its own.
  PASSWORD_CHANGE_COMPLETED: 'AUTH_PASSWORD_CHANGE_COMPLETED',
  /** Rejected by the password policy or the history rule (Scenarios 12-16). */
  PASSWORD_CHANGE_FAILED: 'AUTH_PASSWORD_CHANGE_FAILED',
  /** The submitted current password did not match the stored hash (Scenario 8). */
  PASSWORD_CHANGE_DENIED_CREDENTIALS: 'AUTH_PASSWORD_CHANGE_DENIED_CREDENTIALS',
  /** The account is no longer ACTIVE, or is locked (Scenarios 21, 22). */
  PASSWORD_CHANGE_DENIED_INELIGIBLE: 'AUTH_PASSWORD_CHANGE_DENIED_INELIGIBLE',
  /**
   * Session revocation failed after the new password had already committed
   * (Scenario 34). The credential change stands; this records that the sessions
   * which should have been revoked may still be live.
   */
  PASSWORD_CHANGE_REVOCATION_FAILED: 'AUTH_PASSWORD_CHANGE_REVOCATION_FAILED',

  // --- Field Employee GPS check-in ----------------------------------------
  // Split by outcome for the same reason as the auth actions above: a verified
  // check-in is routine, a failed one is ordinary field friction, a denial is a
  // permission problem worth investigating, and a persistence failure is an
  // operational alarm. Metadata carries the failure reason and the accuracy,
  // but never the coordinates — those live on the gps_check_ins row, and
  // copying them here would spread location data across a second store with a
  // different retention story (Scenario 33).
  /** A location passed every rule and was recorded VERIFIED (Scenario 4). */
  CHECKIN_VERIFIED: 'FIELD_CHECKIN_VERIFIED',
  /**
   * An attempt was recorded FAILED (Scenarios 6-12, 21). The cause is in
   * `metadata.failureReason`, not in the action, because the causes share one
   * response and splitting them would not change who needs to be alerted.
   */
  CHECKIN_FAILED: 'FIELD_CHECKIN_FAILED',
  /** An authenticated caller lacked `field.checkin` (Scenarios 3, 30). */
  CHECKIN_DENIED_PERMISSION: 'FIELD_CHECKIN_DENIED_PERMISSION',
  /**
   * The caller has no branch scope, so there is nothing to check in against.
   * Recorded rather than silently refused: it means an org-wide account reached
   * a field-only screen, which is a provisioning mistake worth seeing.
   */
  CHECKIN_DENIED_NO_BRANCH: 'FIELD_CHECKIN_DENIED_NO_BRANCH',
  /**
   * A repeat submission of an existing `clientAttemptId` (Scenario 37). Logged
   * so a retry storm is visible, but deliberately not a failure — idempotent
   * replay is the correct outcome, not an error.
   */
  CHECKIN_DUPLICATE_IGNORED: 'FIELD_CHECKIN_DUPLICATE_IGNORED',
  /**
   * The verdict was reached but the row could not be committed (Scenario 35).
   * Distinct from CHECKIN_FAILED: the location may well have been valid, and
   * the user was told the check-in did not durably record.
   */
  CHECKIN_PERSISTENCE_FAILED: 'FIELD_CHECKIN_PERSISTENCE_FAILED',
  /** Someone's check-in history was read (Scenario 33, Q-GPS-14). */
  CHECKIN_HISTORY_VIEWED: 'FIELD_CHECKIN_HISTORY_VIEWED',
  /** A history read was refused for permission or branch scope (Scenario 25). */
  CHECKIN_HISTORY_DENIED: 'FIELD_CHECKIN_HISTORY_DENIED',

  // --- Module 02: Organizations & Branches ---------------------------------
  //
  // Reads are logged as well as writes: the story requires it explicitly
  // (Scenarios 1, 2, 13, 14), because seeing the organizational structure is
  // itself privileged. Denials carry the real cause in metadata.reason while
  // the caller gets a single indistinguishable message, so the audit trail
  // stays diagnostic without the endpoint becoming an enumeration oracle.
  ORG_VIEWED: 'ORG_VIEWED',
  ORG_UPDATED: 'ORG_UPDATED',
  ORG_ACTIVATED: 'ORG_ACTIVATED',
  ORG_DEACTIVATED: 'ORG_DEACTIVATED',
  ORG_UPDATE_FAILED: 'ORG_UPDATE_FAILED',

  BRANCH_LISTED: 'BRANCH_LISTED',
  BRANCH_VIEWED: 'BRANCH_VIEWED',
  BRANCH_CREATED: 'BRANCH_CREATED',
  BRANCH_UPDATED: 'BRANCH_UPDATED',
  BRANCH_ACTIVATED: 'BRANCH_ACTIVATED',
  BRANCH_DEACTIVATED: 'BRANCH_DEACTIVATED',
  BRANCH_DELETED: 'BRANCH_DELETED',
  /** Deletion refused because downstream records reference the branch. */
  BRANCH_DELETE_BLOCKED: 'BRANCH_DELETE_BLOCKED',
  /** A read or write aimed outside the caller's org/branch scope. */
  BRANCH_SCOPE_DENIED: 'BRANCH_SCOPE_DENIED',
  /** Create refused on a business rule: duplicate code, or inactive parent. */
  BRANCH_CREATE_REJECTED: 'BRANCH_CREATE_REJECTED',
  BRANCH_PERSISTENCE_FAILED: 'BRANCH_PERSISTENCE_FAILED',

  // --- Module 03: Users, Employees, Roles & Permissions --------------------
  //
  // Authorization outcomes, recorded by the guards rather than by a service.
  //
  // These exist because permissions are now re-resolved from the database on
  // every request instead of trusted from the token. That moved three refusals
  // out of the sign-in path and onto the request path, and each needs its own
  // action: an operator looking at a 401 has to be able to tell "the account was
  // deactivated mid-session" from "the authorization query failed" from "the user
  // row is gone". The caller sees one indistinguishable message in all three
  // cases (Rules 56, 57).
  /** A permission check failed. Rule 39 requires every denial be recorded. */
  AUTHZ_PERMISSION_DENIED: 'AUTHZ_PERMISSION_DENIED',
  /** The account was not ACTIVE at request time — Scenarios 9, 45. */
  AUTHZ_DENIED_ACCOUNT_STATUS: 'AUTHZ_DENIED_ACCOUNT_STATUS',
  /** Authorization could not be resolved, so the request failed closed (Scenario 61). */
  AUTHZ_RESOLUTION_FAILED: 'AUTHZ_RESOLUTION_FAILED',
  /** A live session whose user row no longer exists. */
  AUTHZ_USER_MISSING: 'AUTHZ_USER_MISSING',

  USER_LISTED: 'USER_LISTED',
  USER_VIEWED: 'USER_VIEWED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_DELETED: 'USER_DELETED',
  /** Deletion refused because history references the user (Rules 43–45). */
  USER_DELETE_BLOCKED: 'USER_DELETE_BLOCKED',
  /** A read or write aimed outside the caller's org/branch scope. */
  USER_SCOPE_DENIED: 'USER_SCOPE_DENIED',
  /** Create refused on a business rule: duplicate identifier, inactive branch. */
  USER_CREATE_REJECTED: 'USER_CREATE_REJECTED',
  /** A lifecycle change refused to avoid locking the organization out. */
  USER_LOCKOUT_PREVENTED: 'USER_LOCKOUT_PREVENTED',
  USER_PERSISTENCE_FAILED: 'USER_PERSISTENCE_FAILED',
  USER_ROLES_ASSIGNED: 'USER_ROLES_ASSIGNED',
  /** Role assignment refused: inactive role, or one the actor cannot delegate. */
  USER_ROLE_ASSIGN_DENIED: 'USER_ROLE_ASSIGN_DENIED',

  EMPLOYEE_LISTED: 'EMPLOYEE_LISTED',
  EMPLOYEE_VIEWED: 'EMPLOYEE_VIEWED',
  EMPLOYEE_CREATED: 'EMPLOYEE_CREATED',
  EMPLOYEE_UPDATED: 'EMPLOYEE_UPDATED',
  /** A branch reassignment. Carries the old and new branch (Scenario 50). */
  EMPLOYEE_ASSIGNED: 'EMPLOYEE_ASSIGNED',
  EMPLOYEE_ASSIGN_REJECTED: 'EMPLOYEE_ASSIGN_REJECTED',
  EMPLOYEE_ACTIVATED: 'EMPLOYEE_ACTIVATED',
  EMPLOYEE_DEACTIVATED: 'EMPLOYEE_DEACTIVATED',
  EMPLOYEE_DELETED: 'EMPLOYEE_DELETED',

  ROLE_LISTED: 'ROLE_LISTED',
  ROLE_VIEWED: 'ROLE_VIEWED',
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_UPDATED: 'ROLE_UPDATED',
  ROLE_ACTIVATED: 'ROLE_ACTIVATED',
  ROLE_DEACTIVATED: 'ROLE_DEACTIVATED',
  ROLE_DELETED: 'ROLE_DELETED',
  /** Deletion refused because users still hold the role (Scenario 56). */
  ROLE_DELETE_BLOCKED: 'ROLE_DELETE_BLOCKED',
  ROLE_SCOPE_DENIED: 'ROLE_SCOPE_DENIED',
  /** Create refused on a business rule, typically a duplicate role code. */
  ROLE_CREATE_REJECTED: 'ROLE_CREATE_REJECTED',
  /** The role's permission set changed. Carries both sets (Scenario 52). */
  ROLE_PERMISSIONS_UPDATED: 'ROLE_PERMISSIONS_UPDATED',
  /** Refused by the delegation subset rule (Rule 27, Scenario 37). */
  ROLE_PERMISSIONS_DENIED: 'ROLE_PERMISSIONS_DENIED',
  /** An attempt to modify a system role, which cannot lose access. */
  ROLE_SYSTEM_PROTECTED: 'ROLE_SYSTEM_PROTECTED',
  ROLE_PERSISTENCE_FAILED: 'ROLE_PERSISTENCE_FAILED',

  PERMISSION_CATALOG_VIEWED: 'PERMISSION_CATALOG_VIEWED',

  // --- Module 04: Customers & KYC ---
  //
  // Rule 21 requires customer creation, profile changes, KYC actions, guarantor
  // changes and customer-type changes to be audited, and Scenarios 33-35 name
  // the actor, timestamp and outcome as required fields. Reads are audited too,
  // for the same reason as Module 03: a KYC document is regulated personal data,
  // so "who looked at this" is itself the record (Scenario 34).
  CUSTOMER_LISTED: 'CUSTOMER_LISTED',
  CUSTOMER_VIEWED: 'CUSTOMER_VIEWED',
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  CUSTOMER_ACTIVATED: 'CUSTOMER_ACTIVATED',
  CUSTOMER_DEACTIVATED: 'CUSTOMER_DEACTIVATED',
  CUSTOMER_DELETED: 'CUSTOMER_DELETED',
  /** A delete refused by the dependency guard, with the blockers in metadata. */
  CUSTOMER_DELETE_BLOCKED: 'CUSTOMER_DELETE_BLOCKED',
  /**
   * A read or write that named a real customer the caller could not reach.
   * Recorded even though the caller is told only "not found" — the refusal is
   * exactly what an auditor needs to see (Scenarios 21, 30).
   */
  CUSTOMER_SCOPE_DENIED: 'CUSTOMER_SCOPE_DENIED',
  /** Creation stopped at a possible duplicate; the caller had not sent force. */
  CUSTOMER_DUPLICATE_FLAGGED: 'CUSTOMER_DUPLICATE_FLAGGED',
  /** Creation proceeded despite a flagged duplicate, on an explicit override. */
  CUSTOMER_DUPLICATE_OVERRIDDEN: 'CUSTOMER_DUPLICATE_OVERRIDDEN',
  /** LOCAL → KYC. Carries both the previous and new type (Scenario 35). */
  CUSTOMER_TYPE_CONVERTED: 'CUSTOMER_TYPE_CONVERTED',
  CUSTOMER_CONVERT_REJECTED: 'CUSTOMER_CONVERT_REJECTED',
  /** An edit refused because the record moved under the caller (Scenario 41). */
  CUSTOMER_CONCURRENT_EDIT_REJECTED: 'CUSTOMER_CONCURRENT_EDIT_REJECTED',
  CUSTOMER_ACTIVATION_REJECTED: 'CUSTOMER_ACTIVATION_REJECTED',
  /** The transaction failed; no customer was created (Scenario 38). */
  CUSTOMER_PERSISTENCE_FAILED: 'CUSTOMER_PERSISTENCE_FAILED',

  CUSTOMER_KYC_VIEWED: 'CUSTOMER_KYC_VIEWED',
  CUSTOMER_KYC_SUBMITTED: 'CUSTOMER_KYC_SUBMITTED',
  CUSTOMER_KYC_APPROVED: 'CUSTOMER_KYC_APPROVED',
  CUSTOMER_KYC_REJECTED: 'CUSTOMER_KYC_REJECTED',
  CUSTOMER_KYC_REVISION_REQUESTED: 'CUSTOMER_KYC_REVISION_REQUESTED',
  /** Approval refused for an incomplete required document set (Scenario 7). */
  CUSTOMER_KYC_APPROVAL_BLOCKED: 'CUSTOMER_KYC_APPROVAL_BLOCKED',
  /** The approval transaction failed; the customer did not become ACTIVE. */
  CUSTOMER_KYC_PERSISTENCE_FAILED: 'CUSTOMER_KYC_PERSISTENCE_FAILED',

  CUSTOMER_DOCUMENT_UPLOADED: 'CUSTOMER_DOCUMENT_UPLOADED',
  /** The prior version of a replaced document (Scenario 11). */
  CUSTOMER_DOCUMENT_SUPERSEDED: 'CUSTOMER_DOCUMENT_SUPERSEDED',
  CUSTOMER_DOCUMENT_VERIFIED: 'CUSTOMER_DOCUMENT_VERIFIED',
  CUSTOMER_DOCUMENT_REJECTED: 'CUSTOMER_DOCUMENT_REJECTED',
  /** Someone read the bytes. The whole point of routing files through the API. */
  CUSTOMER_DOCUMENT_DOWNLOADED: 'CUSTOMER_DOCUMENT_DOWNLOADED',
  /** A direct document request from outside the caller's scope (Scenario 32). */
  CUSTOMER_DOCUMENT_ACCESS_DENIED: 'CUSTOMER_DOCUMENT_ACCESS_DENIED',
  CUSTOMER_DOCUMENT_REJECTED_UPLOAD: 'CUSTOMER_DOCUMENT_REJECTED_UPLOAD',

  CUSTOMER_GUARANTOR_ADDED: 'CUSTOMER_GUARANTOR_ADDED',
  CUSTOMER_GUARANTOR_UPDATED: 'CUSTOMER_GUARANTOR_UPDATED',
  CUSTOMER_GUARANTOR_REMOVED: 'CUSTOMER_GUARANTOR_REMOVED',
  CUSTOMER_GUARANTOR_CONSENT_RECORDED: 'CUSTOMER_GUARANTOR_CONSENT_RECORDED',

  /* Module 05 — guarantor lifecycle, access and KYC. */
  CUSTOMER_GUARANTOR_LISTED: 'CUSTOMER_GUARANTOR_LISTED',
  CUSTOMER_GUARANTOR_VIEWED: 'CUSTOMER_GUARANTOR_VIEWED',
  /** A guarantor reached from outside the caller's scope (Scenarios 4, 5, 37). */
  CUSTOMER_GUARANTOR_ACCESS_DENIED: 'CUSTOMER_GUARANTOR_ACCESS_DENIED',
  /** A same-mobile match on the same customer was reported (Scenario 10). */
  CUSTOMER_GUARANTOR_DUPLICATE_FLAGGED: 'CUSTOMER_GUARANTOR_DUPLICATE_FLAGGED',
  /** The caller confirmed and created anyway. Recorded distinctly from a clean
   * create, so "we warned and they proceeded" is answerable after the fact. */
  CUSTOMER_GUARANTOR_DUPLICATE_OVERRIDDEN:
    'CUSTOMER_GUARANTOR_DUPLICATE_OVERRIDDEN',
  CUSTOMER_GUARANTOR_DEACTIVATED: 'CUSTOMER_GUARANTOR_DEACTIVATED',
  CUSTOMER_GUARANTOR_REACTIVATED: 'CUSTOMER_GUARANTOR_REACTIVATED',
  /** A delete refused because a loan references the guarantor (Scenarios 32, 55). */
  CUSTOMER_GUARANTOR_DELETE_BLOCKED: 'CUSTOMER_GUARANTOR_DELETE_BLOCKED',
  CUSTOMER_GUARANTOR_CONCURRENT_EDIT_REJECTED:
    'CUSTOMER_GUARANTOR_CONCURRENT_EDIT_REJECTED',
  /** Validation passed but the write did not commit (Scenario 44). */
  CUSTOMER_GUARANTOR_PERSISTENCE_FAILED:
    'CUSTOMER_GUARANTOR_PERSISTENCE_FAILED',
  /** An inactive guarantor was offered for a new relationship (Scenario 27). */
  CUSTOMER_GUARANTOR_SELECTION_BLOCKED: 'CUSTOMER_GUARANTOR_SELECTION_BLOCKED',

  CUSTOMER_GUARANTOR_DOCUMENT_UPLOADED: 'CUSTOMER_GUARANTOR_DOCUMENT_UPLOADED',
  CUSTOMER_GUARANTOR_DOCUMENT_SUPERSEDED:
    'CUSTOMER_GUARANTOR_DOCUMENT_SUPERSEDED',
  CUSTOMER_GUARANTOR_DOCUMENT_VERIFIED: 'CUSTOMER_GUARANTOR_DOCUMENT_VERIFIED',
  CUSTOMER_GUARANTOR_DOCUMENT_REJECTED: 'CUSTOMER_GUARANTOR_DOCUMENT_REJECTED',
  CUSTOMER_GUARANTOR_DOCUMENT_REJECTED_UPLOAD:
    'CUSTOMER_GUARANTOR_DOCUMENT_REJECTED_UPLOAD',
  CUSTOMER_GUARANTOR_DOCUMENT_DOWNLOADED:
    'CUSTOMER_GUARANTOR_DOCUMENT_DOWNLOADED',
  CUSTOMER_GUARANTOR_DOCUMENT_ACCESS_DENIED:
    'CUSTOMER_GUARANTOR_DOCUMENT_ACCESS_DENIED',

  CUSTOMER_GUARANTOR_KYC_SUBMITTED: 'CUSTOMER_GUARANTOR_KYC_SUBMITTED',
  CUSTOMER_GUARANTOR_KYC_APPROVED: 'CUSTOMER_GUARANTOR_KYC_APPROVED',
  CUSTOMER_GUARANTOR_KYC_REJECTED: 'CUSTOMER_GUARANTOR_KYC_REJECTED',
  CUSTOMER_GUARANTOR_KYC_REVISION_REQUESTED:
    'CUSTOMER_GUARANTOR_KYC_REVISION_REQUESTED',
  /** Approval refused because the required documents are not all verified
   * (Scenario 21). Distinct from a rejection: nobody decided against it. */
  CUSTOMER_GUARANTOR_KYC_APPROVAL_BLOCKED:
    'CUSTOMER_GUARANTOR_KYC_APPROVAL_BLOCKED',

  CUSTOMER_MOBILE_OTP_SENT: 'CUSTOMER_MOBILE_OTP_SENT',
  CUSTOMER_MOBILE_VERIFIED: 'CUSTOMER_MOBILE_VERIFIED',
  CUSTOMER_MOBILE_VERIFY_FAILED: 'CUSTOMER_MOBILE_VERIFY_FAILED',

  // --- Module 06: Loan Products & Configuration ----------------------------
  //
  // Reads are audited alongside writes, as elsewhere: product configuration
  // decides what every borrower in the organization can be charged, so who
  // looked at it is part of the record and not only who changed it.
  LOAN_PRODUCT_LISTED: 'LOAN_PRODUCT_LISTED',
  LOAN_PRODUCT_VIEWED: 'LOAN_PRODUCT_VIEWED',
  LOAN_PRODUCT_CREATED: 'LOAN_PRODUCT_CREATED',
  LOAN_PRODUCT_UPDATED: 'LOAN_PRODUCT_UPDATED',
  LOAN_PRODUCT_ACTIVATED: 'LOAN_PRODUCT_ACTIVATED',
  LOAN_PRODUCT_DEACTIVATED: 'LOAN_PRODUCT_DEACTIVATED',
  /** A create refused before it was attempted — duplicate code, and the like. */
  LOAN_PRODUCT_CREATE_REJECTED: 'LOAN_PRODUCT_CREATE_REJECTED',
  LOAN_PRODUCT_SCOPE_DENIED: 'LOAN_PRODUCT_SCOPE_DENIED',
  LOAN_PRODUCT_CONCURRENT_EDIT_REJECTED:
    'LOAN_PRODUCT_CONCURRENT_EDIT_REJECTED',
  LOAN_PRODUCT_PERSISTENCE_FAILED: 'LOAN_PRODUCT_PERSISTENCE_FAILED',

  LOAN_SCHEME_LISTED: 'LOAN_SCHEME_LISTED',
  LOAN_SCHEME_VIEWED: 'LOAN_SCHEME_VIEWED',
  LOAN_SCHEME_CREATED: 'LOAN_SCHEME_CREATED',
  LOAN_SCHEME_UPDATED: 'LOAN_SCHEME_UPDATED',
  LOAN_SCHEME_ACTIVATED: 'LOAN_SCHEME_ACTIVATED',
  LOAN_SCHEME_DEACTIVATED: 'LOAN_SCHEME_DEACTIVATED',
  LOAN_SCHEME_CREATE_REJECTED: 'LOAN_SCHEME_CREATE_REJECTED',
  LOAN_SCHEME_SCOPE_DENIED: 'LOAN_SCHEME_SCOPE_DENIED',
  LOAN_SCHEME_CONCURRENT_EDIT_REJECTED: 'LOAN_SCHEME_CONCURRENT_EDIT_REJECTED',
  LOAN_SCHEME_PERSISTENCE_FAILED: 'LOAN_SCHEME_PERSISTENCE_FAILED',
  /** Activation refused because the scheme has no active duration option — a
   * scheme nothing can be borrowed over is not a scheme (Module 06). */
  LOAN_SCHEME_ACTIVATION_BLOCKED: 'LOAN_SCHEME_ACTIVATION_BLOCKED',

  LOAN_SCHEME_DURATION_ADDED: 'LOAN_SCHEME_DURATION_ADDED',
  LOAN_SCHEME_DURATION_UPDATED: 'LOAN_SCHEME_DURATION_UPDATED',
  LOAN_SCHEME_DURATION_REMOVED: 'LOAN_SCHEME_DURATION_REMOVED',
  /** A duration delete refused because applications already reference it. */
  LOAN_SCHEME_DURATION_DELETE_BLOCKED: 'LOAN_SCHEME_DURATION_DELETE_BLOCKED',

  // --- Module 07: Loan Applications ----------------------------------------
  //
  // Reads are audited as well as writes (Rule 54): an application carries the
  // borrower's financial position, so who looked is part of the record.
  LOAN_APPLICATION_LISTED: 'LOAN_APPLICATION_LISTED',
  LOAN_APPLICATION_VIEWED: 'LOAN_APPLICATION_VIEWED',
  LOAN_APPLICATION_CREATED: 'LOAN_APPLICATION_CREATED',
  LOAN_APPLICATION_UPDATED: 'LOAN_APPLICATION_UPDATED',
  LOAN_APPLICATION_DELETED: 'LOAN_APPLICATION_DELETED',
  /** A delete refused: not a draft, or the draft has documents/reviews
   * (Scenarios 34, 35, 36). */
  LOAN_APPLICATION_DELETE_BLOCKED: 'LOAN_APPLICATION_DELETE_BLOCKED',

  LOAN_APPLICATION_SUBMITTED: 'LOAN_APPLICATION_SUBMITTED',
  /** Submission refused by the completeness gate (Scenarios 7, 12, 18). */
  LOAN_APPLICATION_SUBMIT_BLOCKED: 'LOAN_APPLICATION_SUBMIT_BLOCKED',
  LOAN_APPLICATION_REVIEW_STARTED: 'LOAN_APPLICATION_REVIEW_STARTED',
  LOAN_APPLICATION_INFO_REQUESTED: 'LOAN_APPLICATION_INFO_REQUESTED',
  LOAN_APPLICATION_TERMS_MODIFIED: 'LOAN_APPLICATION_TERMS_MODIFIED',
  LOAN_APPLICATION_APPROVED: 'LOAN_APPLICATION_APPROVED',
  LOAN_APPLICATION_REJECTED: 'LOAN_APPLICATION_REJECTED',

  LOAN_APPLICATION_CREATE_REJECTED: 'LOAN_APPLICATION_CREATE_REJECTED',
  LOAN_APPLICATION_SCOPE_DENIED: 'LOAN_APPLICATION_SCOPE_DENIED',
  /** An illegal move — approving a rejected application, and the like
   * (Rules 85, 86). Distinct from a concurrency loss: nothing raced, the
   * transition was simply not available from that state. */
  LOAN_APPLICATION_TRANSITION_REJECTED: 'LOAN_APPLICATION_TRANSITION_REJECTED',
  /** The `updateMany` guard matched no row: someone else moved it first
   * (Scenario 52). */
  LOAN_APPLICATION_CONCURRENT_EDIT_REJECTED:
    'LOAN_APPLICATION_CONCURRENT_EDIT_REJECTED',
  LOAN_APPLICATION_PERSISTENCE_FAILED: 'LOAN_APPLICATION_PERSISTENCE_FAILED',

  LOAN_APPLICATION_DOCUMENT_UPLOADED: 'LOAN_APPLICATION_DOCUMENT_UPLOADED',
  LOAN_APPLICATION_DOCUMENT_SUPERSEDED: 'LOAN_APPLICATION_DOCUMENT_SUPERSEDED',
  LOAN_APPLICATION_DOCUMENT_VERIFIED: 'LOAN_APPLICATION_DOCUMENT_VERIFIED',
  LOAN_APPLICATION_DOCUMENT_REJECTED: 'LOAN_APPLICATION_DOCUMENT_REJECTED',
  /** An upload refused before storage — empty, oversized or wrong type
   * (Scenario 19). Distinct from DOCUMENT_REJECTED, which is a reviewer's
   * decision about a document that did land. */
  LOAN_APPLICATION_DOCUMENT_REJECTED_UPLOAD:
    'LOAN_APPLICATION_DOCUMENT_REJECTED_UPLOAD',
  LOAN_APPLICATION_DOCUMENT_DOWNLOADED: 'LOAN_APPLICATION_DOCUMENT_DOWNLOADED',
  LOAN_APPLICATION_DOCUMENT_ACCESS_DENIED:
    'LOAN_APPLICATION_DOCUMENT_ACCESS_DENIED',

  // --- Module 08: Approval Workflow -----------------------------------------
  //
  // These records are also the notification seam. Rules 49-52 and Scenarios
  // 54-57 ask for SMS and App Push to Customer and Branch Admin on approval,
  // rejection and sanction, logged and retried up to three times with a final
  // failure alerting Admin. Module 16 owns delivery; every point a notification
  // would fire writes one of these, and those rows are what a notification
  // engine will read. Nothing in Module 08 sends anything, and nothing there
  // may fail a transition because a message failed (Rule 49).

  /** Assessment reads are audited for the same reason application reads are:
   * a CIBIL score is the borrower's financial position, so who looked at it is
   * part of the record. */
  LOAN_CREDIT_ASSESSMENT_VIEWED: 'LOAN_CREDIT_ASSESSMENT_VIEWED',
  LOAN_CREDIT_ASSESSMENT_RECORDED: 'LOAN_CREDIT_ASSESSMENT_RECORDED',
  /** A prior assessment displaced by a newer one. Never deleted — the
   * superseded row is what makes an override auditable (Q-APP-26/27/28). */
  LOAN_CREDIT_ASSESSMENT_SUPERSEDED: 'LOAN_CREDIT_ASSESSMENT_SUPERSEDED',

  /** Approval refused by a gate — documents, credit assessment or EMI
   * (Scenarios 6, 8, 9). Distinct from TRANSITION_REJECTED, which is a refusal
   * on the status itself, and from a permission denial. */
  LOAN_APPLICATION_APPROVE_BLOCKED: 'LOAN_APPLICATION_APPROVE_BLOCKED',

  LOAN_APPLICATION_SANCTIONED: 'LOAN_APPLICATION_SANCTIONED',
  LOAN_SANCTION_VIEWED: 'LOAN_SANCTION_VIEWED',
  LOAN_SANCTION_ACCEPTED: 'LOAN_SANCTION_ACCEPTED',
  /** The customer declined the sanction letter. The application moves to the
   * unified REJECTED (Rule 13), so this action is the only thing in the audit
   * trail that distinguishes a decline from an admin rejection. */
  LOAN_SANCTION_DECLINED: 'LOAN_SANCTION_DECLINED',
  LOAN_AGREEMENT_SIGNED: 'LOAN_AGREEMENT_SIGNED',

  // --- Module 09: Disbursal -------------------------------------------------
  //
  // The first actions in this catalog that record money moving rather than a
  // decision about it, which raises the bar twice over.
  //
  // Rule 42 makes disbursal "fully auditable" and Rules 43-46 require the
  // successful path, the failures, the permission denials and the ledger
  // outcomes all to be recorded. So unlike most modules, the failure actions
  // here are not defensive extras — they are named in the source.
  //
  // These rows are also the notification seam, on the same terms as Module 08:
  // Module 16 owns delivery, every point a disbursal notification would fire
  // writes one of these, and nothing here may fail a disbursal because a
  // message failed.
  //
  // One naming caution: `sanitizeMetadata` drops any metadata key matching
  // /pass|pwd|secret|token|hash|credential/i by KEY NAME, not by value. A field
  // called `transactionToken` would vanish silently. `transactionReference` is
  // the safe name and the one every call site uses.

  /** A loan row created from a signed agreement. Module 09 is its only writer. */
  LOAN_CREATED: 'LOAN_CREATED',
  /** The loan became repayable: money moved and the schedule exists. */
  LOAN_ACTIVATED: 'LOAN_ACTIVATED',
  /** A loan out of the caller's org/branch reach. 404, never 403 — see
   * `LoanService.findInScope` (Scenarios 3, 4). */
  LOAN_SCOPE_DENIED: 'LOAN_SCOPE_DENIED',

  /** Rule 63 / Scenario 1: even reading the queue is audited. Disbursal is a
   * financial surface, so who looked at what was fundable is part of the
   * record — the same reasoning that audits application and assessment reads. */
  DISBURSEMENT_QUEUE_VIEWED: 'DISBURSEMENT_QUEUE_VIEWED',
  DISBURSEMENT_SCHEDULED: 'DISBURSEMENT_SCHEDULED',
  DISBURSEMENT_SCHEDULE_UPDATED: 'DISBURSEMENT_SCHEDULE_UPDATED',
  DISBURSEMENT_TRANSFER_RECORDED: 'DISBURSEMENT_TRANSFER_RECORDED',
  /** The irreversible one: ledger posted, loan active, schedule generated. */
  DISBURSEMENT_CONFIRMED: 'DISBURSEMENT_CONFIRMED',
  DISBURSEMENT_CANCELLED: 'DISBURSEMENT_CANCELLED',

  /** Refused by a gate — agreement, sanction response, amount, account
   * (Scenarios 8, 9, 10, 18). Distinct from a permission denial and from a
   * transition refused on status alone. */
  DISBURSEMENT_BLOCKED: 'DISBURSEMENT_BLOCKED',
  /** The external transfer failed (Scenario 26). The loan is NOT disbursed and
   * the disbursement stays retryable — Rule 16. */
  DISBURSEMENT_TRANSFER_FAILED: 'DISBURSEMENT_TRANSFER_FAILED',
  /** Ledger posting failed, so the whole disbursal rolled back (Rules 14, 17;
   * Scenario 20). Recorded outside the failed transaction, or it would roll
   * back with it and leave no trace of why. */
  DISBURSEMENT_LEDGER_FAILED: 'DISBURSEMENT_LEDGER_FAILED',
  /** A confirm replayed against an existing Idempotency-Key. Reported as a
   * success with the original result, never as an error (Scenarios 28, 46) —
   * the same treatment `CHECKIN_DUPLICATE_IGNORED` gets. */
  DISBURSEMENT_DUPLICATE_IGNORED: 'DISBURSEMENT_DUPLICATE_IGNORED',
  /** A duplicate transaction reference refused (Rule 18, Scenario 17). */
  DISBURSEMENT_DUPLICATE_REFERENCE: 'DISBURSEMENT_DUPLICATE_REFERENCE',
  DISBURSEMENT_SCOPE_DENIED: 'DISBURSEMENT_SCOPE_DENIED',
  DISBURSEMENT_CONCURRENT_ATTEMPT_REJECTED:
    'DISBURSEMENT_CONCURRENT_ATTEMPT_REJECTED',

  /** The balanced double-entry posted. Traceable to the disbursement and loan
   * through `sourceType`/`sourceId` (Scenario 49). */
  DISBURSEMENT_LEDGER_POSTED: 'DISBURSEMENT_LEDGER_POSTED',
  /** Version 1 of the repayment schedule, generated in the same transaction as
   * the disbursal (Scenario 24). */
  REPAYMENT_SCHEDULE_GENERATED: 'REPAYMENT_SCHEDULE_GENERATED',

  // --- Module 10: repayment schedule ---
  //
  // Reads *are* audited here, unlike master data: a repayment schedule is the
  // borrower's financial obligation, and Module 10 Rule 37 requires every action
  // on one to be logged. Split by outcome rather than carrying a `reason`, on
  // the catalog's usual rule — a blocked regeneration and a stale one need
  // different alerting.
  REPAYMENT_SCHEDULE_LISTED: 'REPAYMENT_SCHEDULE_LISTED',
  REPAYMENT_SCHEDULE_VIEWED: 'REPAYMENT_SCHEDULE_VIEWED',
  /** A new version became authoritative. Metadata carries both version numbers
   * and the reason, which is what Scenario 43 asks the trail to retain. */
  REPAYMENT_SCHEDULE_REGENERATED: 'REPAYMENT_SCHEDULE_REGENERATED',
  /** The previous version was retired. Emitted beside `_REGENERATED` rather
   * than folded into it, so the retired version is searchable by its own id. */
  REPAYMENT_SCHEDULE_SUPERSEDED: 'REPAYMENT_SCHEDULE_SUPERSEDED',
  /** Refused because downstream payments, penalties or recovery cases reference
   * it (Scenario 17). The caller was permitted to try — this is not a denial. */
  REPAYMENT_SCHEDULE_REGENERATION_BLOCKED:
    'REPAYMENT_SCHEDULE_REGENERATION_BLOCKED',
  /** Recovery from a failed generation (Scenario 29). */
  REPAYMENT_SCHEDULE_RETRIED: 'REPAYMENT_SCHEDULE_RETRIED',
  /** Generation failed and no schedule was activated (Scenarios 28, 44). The
   * absence of a `_GENERATED` beside this is the point. */
  REPAYMENT_SCHEDULE_GENERATION_FAILED: 'REPAYMENT_SCHEDULE_GENERATION_FAILED',
  /** A stale client lost the race (Scenarios 40, 41). */
  REPAYMENT_SCHEDULE_CONCURRENT_ATTEMPT_REJECTED:
    'REPAYMENT_SCHEDULE_CONCURRENT_ATTEMPT_REJECTED',
  /** Downloaded as CSV or PDF. Metadata records which format. */
  REPAYMENT_SCHEDULE_EXPORTED: 'REPAYMENT_SCHEDULE_EXPORTED',

  // --- EMI collection (Module 11) ---
  //
  // Rule 47: every action is audited, and Rule 46 names failures, reversals and
  // permission denials specifically. Reads are audited here — unlike master
  // data — because a collection carries a borrower's payment history, and who
  // looked at it is exactly the kind of question an audit is for.
  //
  // Note the metadata key naming. `sanitizeMetadata` drops any key matching
  // /pass|pwd|secret|token|hash|credential/i, so the request digest must be
  // recorded as `requestFingerprint`; a key named `requestHash` would be
  // stripped silently and the idempotency-conflict trail would be empty.
  COLLECTION_LISTED: 'COLLECTION_LISTED',
  COLLECTION_VIEWED: 'COLLECTION_VIEWED',
  COLLECTION_READINESS_VIEWED: 'COLLECTION_READINESS_VIEWED',
  COLLECTION_ALLOCATION_PREVIEWED: 'COLLECTION_ALLOCATION_PREVIEWED',
  COLLECTION_CREATED: 'COLLECTION_CREATED',
  COLLECTION_POSTED: 'COLLECTION_POSTED',
  COLLECTION_LEDGER_POSTED: 'COLLECTION_LEDGER_POSTED',
  COLLECTION_REVERSED: 'COLLECTION_REVERSED',
  COLLECTION_LEDGER_REVERSED: 'COLLECTION_LEDGER_REVERSED',
  /** An eligibility gate refused the posting. No money moved. */
  COLLECTION_BLOCKED: 'COLLECTION_BLOCKED',
  /**
   * The posting transaction rolled back. Recorded *outside* that transaction so
   * it survives the rollback — the same reason `DISBURSEMENT_LEDGER_FAILED` is.
   */
  COLLECTION_POSTING_FAILED: 'COLLECTION_POSTING_FAILED',
  /** A retry of an already-posted request. A success, not an error. */
  COLLECTION_DUPLICATE_IGNORED: 'COLLECTION_DUPLICATE_IGNORED',
  /** The same key with a materially different body. Refused. */
  COLLECTION_IDEMPOTENCY_CONFLICT: 'COLLECTION_IDEMPOTENCY_CONFLICT',
  COLLECTION_RECEIPT_CONFLICT: 'COLLECTION_RECEIPT_CONFLICT',
  COLLECTION_SCOPE_DENIED: 'COLLECTION_SCOPE_DENIED',
  COLLECTION_CONCURRENT_ATTEMPT_REJECTED:
    'COLLECTION_CONCURRENT_ATTEMPT_REJECTED',
  COLLECTION_SYNC_RECEIVED: 'COLLECTION_SYNC_RECEIVED',
  COLLECTION_SYNC_CONFLICT: 'COLLECTION_SYNC_CONFLICT',
  COLLECTION_SYNC_REJECTED_STALE: 'COLLECTION_SYNC_REJECTED_STALE',
  COLLECTION_DELETE_BLOCKED: 'COLLECTION_DELETE_BLOCKED',

  // --- Field collection and cash custody (Module 12) ---
  //
  // Rule 45 names collection, sync, handover, reconciliation, discrepancy,
  // reversal, approval, rejection and denial specifically. The metadata-key
  // discipline from Module 11 above applies unchanged: `requestFingerprint`,
  // never `requestHash`.
  //
  // Actions are split by *outcome* rather than carrying a `reason` field, so a
  // query for "how often was a handover refused for exceeding the balance" is a
  // filter on one value rather than a scan of metadata.

  FIELD_COLLECTION_LISTED: 'FIELD_COLLECTION_LISTED',
  FIELD_COLLECTION_VIEWED: 'FIELD_COLLECTION_VIEWED',
  FIELD_COLLECTION_RECORDED: 'FIELD_COLLECTION_RECORDED',
  FIELD_COLLECTION_SYNC_RECEIVED: 'FIELD_COLLECTION_SYNC_RECEIVED',
  FIELD_COLLECTION_SYNC_CONFLICT: 'FIELD_COLLECTION_SYNC_CONFLICT',
  /**
   * The reported GPS outcome, recorded as the device reported it.
   *
   * Written for failures as loudly as for successes. Rule 41 and Scenario 55
   * turn on a failed capture never later reading as a success, and an audit
   * trail that only records the successes is how that erosion goes unnoticed.
   */
  FIELD_COLLECTION_GPS_EVIDENCE_RECORDED:
    'FIELD_COLLECTION_GPS_EVIDENCE_RECORDED',
  /** A claimed GPS success that named no verified check-in. Refused. */
  FIELD_COLLECTION_GPS_EVIDENCE_REJECTED:
    'FIELD_COLLECTION_GPS_EVIDENCE_REJECTED',
  FIELD_COLLECTION_VERIFIED: 'FIELD_COLLECTION_VERIFIED',
  FIELD_COLLECTION_VERIFICATION_REJECTED:
    'FIELD_COLLECTION_VERIFICATION_REJECTED',
  /**
   * A reversal refused because the cash has already been handed over.
   *
   * Scenario 41: reversing the customer side while the branch holds the cash
   * would leave the agent's balance inconsistent. The operator must reverse the
   * handover first.
   */
  FIELD_COLLECTION_REVERSAL_BLOCKED_HANDED_OVER:
    'FIELD_COLLECTION_REVERSAL_BLOCKED_HANDED_OVER',
  FIELD_COLLECTION_SCOPE_DENIED: 'FIELD_COLLECTION_SCOPE_DENIED',

  CASH_BALANCE_VIEWED: 'CASH_BALANCE_VIEWED',
  CASH_HANDOVER_LISTED: 'CASH_HANDOVER_LISTED',
  CASH_HANDOVER_VIEWED: 'CASH_HANDOVER_VIEWED',
  CASH_HANDOVER_CREATED: 'CASH_HANDOVER_CREATED',
  CASH_HANDOVER_SUBMITTED: 'CASH_HANDOVER_SUBMITTED',
  CASH_HANDOVER_RECEIVED: 'CASH_HANDOVER_RECEIVED',
  CASH_HANDOVER_LEDGER_POSTED: 'CASH_HANDOVER_LEDGER_POSTED',
  CASH_HANDOVER_REVERSED: 'CASH_HANDOVER_REVERSED',
  CASH_HANDOVER_LEDGER_REVERSED: 'CASH_HANDOVER_LEDGER_REVERSED',
  CASH_HANDOVER_CANCELLED: 'CASH_HANDOVER_CANCELLED',
  /** An eligibility gate refused the handover. No custody moved. */
  CASH_HANDOVER_BLOCKED: 'CASH_HANDOVER_BLOCKED',
  /** Scenario 25: more cash claimed than the agent authoritatively holds. */
  CASH_HANDOVER_EXCEEDS_BALANCE: 'CASH_HANDOVER_EXCEEDS_BALANCE',
  /**
   * Scenario 49: a concurrent handover had already claimed these collections.
   *
   * The losing transaction, recorded. This is the audit trail of the claim
   * mechanism working — without it, a double-handover attempt would leave no
   * trace that it was ever attempted.
   */
  CASH_ALREADY_HANDED_OVER: 'CASH_ALREADY_HANDED_OVER',
  /**
   * The receive transaction rolled back. Recorded *outside* it so it survives
   * the rollback — the same reason `COLLECTION_POSTING_FAILED` is.
   */
  CASH_HANDOVER_POSTING_FAILED: 'CASH_HANDOVER_POSTING_FAILED',
  CASH_HANDOVER_DUPLICATE_IGNORED: 'CASH_HANDOVER_DUPLICATE_IGNORED',
  CASH_HANDOVER_IDEMPOTENCY_CONFLICT: 'CASH_HANDOVER_IDEMPOTENCY_CONFLICT',
  CASH_HANDOVER_NUMBER_CONFLICT: 'CASH_HANDOVER_NUMBER_CONFLICT',
  CASH_HANDOVER_CONCURRENT_ATTEMPT_REJECTED:
    'CASH_HANDOVER_CONCURRENT_ATTEMPT_REJECTED',
  CASH_HANDOVER_SCOPE_DENIED: 'CASH_HANDOVER_SCOPE_DENIED',
  CASH_HANDOVER_DELETE_BLOCKED: 'CASH_HANDOVER_DELETE_BLOCKED',

  CASH_RECONCILIATION_LISTED: 'CASH_RECONCILIATION_LISTED',
  CASH_RECONCILIATION_VIEWED: 'CASH_RECONCILIATION_VIEWED',
  CASH_RECONCILIATION_CREATED: 'CASH_RECONCILIATION_CREATED',
  /** Counted cash equalled expected. The uneventful outcome, still recorded. */
  CASH_RECONCILIATION_MATCHED: 'CASH_RECONCILIATION_MATCHED',
  /**
   * A shortage or excess was found.
   *
   * Distinct from `_MATCHED` rather than one action with an amount, because
   * Rule 34 forbids silent auto-correction and the whole point is that a
   * discrepancy is a different kind of event, not the same event with a
   * different number.
   */
  CASH_DISCREPANCY_DETECTED: 'CASH_DISCREPANCY_DETECTED',
  CASH_DISCREPANCY_RESOLVED: 'CASH_DISCREPANCY_RESOLVED',
  CASH_RECONCILIATION_DUPLICATE_IGNORED:
    'CASH_RECONCILIATION_DUPLICATE_IGNORED',
  CASH_RECONCILIATION_IDEMPOTENCY_CONFLICT:
    'CASH_RECONCILIATION_IDEMPOTENCY_CONFLICT',
  CASH_RECONCILIATION_CONCURRENT_ATTEMPT_REJECTED:
    'CASH_RECONCILIATION_CONCURRENT_ATTEMPT_REJECTED',
  CASH_RECONCILIATION_FAILED: 'CASH_RECONCILIATION_FAILED',
  CASH_RECONCILIATION_SCOPE_DENIED: 'CASH_RECONCILIATION_SCOPE_DENIED',
  CASH_RECONCILIATION_DELETE_BLOCKED: 'CASH_RECONCILIATION_DELETE_BLOCKED',

  SYNC_QUEUE_LISTED: 'SYNC_QUEUE_LISTED',
  SYNC_ITEM_QUEUED: 'SYNC_ITEM_QUEUED',
  SYNC_ITEM_RETRIED: 'SYNC_ITEM_RETRIED',
  SYNC_ITEM_CONFLICT: 'SYNC_ITEM_CONFLICT',
  SYNC_ITEM_FAILED: 'SYNC_ITEM_FAILED',

  // --- Master data ---
  //
  // Reads are not audited. Unlike a customer record, an option list carries no
  // personal data and is fetched on nearly every form render, so auditing reads
  // would bury the mutations that matter under noise.
  MASTER_DATA_VALUE_CREATED: 'MASTER_DATA_VALUE_CREATED',
  MASTER_DATA_VALUE_UPDATED: 'MASTER_DATA_VALUE_UPDATED',
  MASTER_DATA_VALUE_DELETED: 'MASTER_DATA_VALUE_DELETED',
  /** A delete refused because the row is seeded and business logic reads it.
   * Distinct from a permission denial: the caller was allowed to try. */
  MASTER_DATA_SYSTEM_VALUE_DELETE_REFUSED:
    'MASTER_DATA_SYSTEM_VALUE_DELETE_REFUSED',

  // --- Module 14: Accounting & Ledger ---
  //
  // Account *reads* are not audited, on the master-data reasoning above: the
  // chart is fetched on every journal form render and carries no personal data.
  // Ledger and reconciliation reads ARE audited, because they are the reports a
  // financial control asks "who looked at this, and when" about.
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  ACCOUNT_UPDATED: 'ACCOUNT_UPDATED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  ACCOUNT_ACTIVATED: 'ACCOUNT_ACTIVATED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  /**
   * A delete refused because posted lines, child accounts or a disbursement
   * reference the account. Distinct from a permission denial: the caller was
   * allowed to try, and the answer is "deactivate instead".
   */
  ACCOUNT_DELETE_BLOCKED: 'ACCOUNT_DELETE_BLOCKED',
  /**
   * An edit refused because the account has posted lines and the request
   * targeted its frozen identity — code, type or normal balance.
   */
  ACCOUNT_IDENTITY_EDIT_BLOCKED: 'ACCOUNT_IDENTITY_EDIT_BLOCKED',
  ACCOUNT_HIERARCHY_CYCLE_REJECTED: 'ACCOUNT_HIERARCHY_CYCLE_REJECTED',
  ACCOUNT_CONCURRENT_ATTEMPT_REJECTED: 'ACCOUNT_CONCURRENT_ATTEMPT_REJECTED',

  JOURNAL_DRAFT_CREATED: 'JOURNAL_DRAFT_CREATED',
  JOURNAL_DRAFT_UPDATED: 'JOURNAL_DRAFT_UPDATED',
  JOURNAL_DRAFT_DELETED: 'JOURNAL_DRAFT_DELETED',
  /** A draft delete refused because something downstream references it. */
  JOURNAL_DELETE_BLOCKED: 'JOURNAL_DELETE_BLOCKED',
  JOURNAL_VALIDATED: 'JOURNAL_VALIDATED',
  /** The act that moves money. Recorded inside the posting transaction. */
  JOURNAL_POSTED: 'JOURNAL_POSTED',
  /**
   * The posting transaction rolled back — an unbalanced set of lines, an
   * inactive account, a scope violation. Recorded *outside* that transaction so
   * it survives the rollback, the same reason `COLLECTION_POSTING_FAILED` is.
   */
  JOURNAL_POSTING_FAILED: 'JOURNAL_POSTING_FAILED',
  JOURNAL_REVERSED: 'JOURNAL_REVERSED',
  JOURNAL_REVERSAL_FAILED: 'JOURNAL_REVERSAL_FAILED',
  /** A second reversal of an already-reversed journal. Refused. */
  JOURNAL_DUPLICATE_REVERSAL_REJECTED: 'JOURNAL_DUPLICATE_REVERSAL_REJECTED',
  /** A retry of an already-posted request. A success, not an error. */
  JOURNAL_DUPLICATE_IGNORED: 'JOURNAL_DUPLICATE_IGNORED',
  /** The same key with a materially different body. Refused. */
  JOURNAL_IDEMPOTENCY_CONFLICT: 'JOURNAL_IDEMPOTENCY_CONFLICT',
  JOURNAL_CONCURRENT_ATTEMPT_REJECTED: 'JOURNAL_CONCURRENT_ATTEMPT_REJECTED',
  JOURNAL_SCOPE_DENIED: 'JOURNAL_SCOPE_DENIED',

  LEDGER_VIEWED: 'LEDGER_VIEWED',
  TRIAL_BALANCE_VIEWED: 'TRIAL_BALANCE_VIEWED',
  /** Reconciliation run. Its findings are recorded in the metadata. */
  RECONCILIATION_RUN: 'RECONCILIATION_RUN',

  // --- Module 13: Overdue & Recovery ---
  //
  // The keys are prefixed `OVERDUE_`, `RECOVERY_CASE_`, `RECOVERY_ACTION_`,
  // `PENALTY_` and `SETTLEMENT_` rather than a bare `RECOVERY_`, because
  // `RECOVERY_REQUESTED` and its siblings above already mean *password*
  // recovery. Two unrelated domains sharing a prefix would make an alerting
  // filter on "recovery" return password resets and debt collection together.
  //
  // Split by outcome rather than carrying a `reason` field, on the Module 11
  // precedent: alerting filters on one value, and a denial that has to be
  // distinguished by reading metadata is a denial nobody alerts on.

  /** Reads. A borrower's delinquency is privileged data, so reads are logged. */
  OVERDUE_LISTED: 'OVERDUE_LISTED',
  OVERDUE_VIEWED: 'OVERDUE_VIEWED',
  OVERDUE_SCOPE_DENIED: 'OVERDUE_SCOPE_DENIED',
  /**
   * The authoritative schedule or balances were inconsistent (Scenario 51).
   *
   * Distinct from a plain failure: the system refused to fabricate a total, and
   * the inconsistency is retained for investigation rather than papered over.
   */
  OVERDUE_CALCULATION_FAILED: 'OVERDUE_CALCULATION_FAILED',

  PENALTY_ASSESSED: 'PENALTY_ASSESSED',
  /** A retried assessment resolved to the existing row rather than charging twice. */
  PENALTY_DUPLICATE_IGNORED: 'PENALTY_DUPLICATE_IGNORED',
  PENALTY_ASSESSMENT_FAILED: 'PENALTY_ASSESSMENT_FAILED',
  PENALTY_WAIVED: 'PENALTY_WAIVED',
  PENALTY_ADJUSTED: 'PENALTY_ADJUSTED',
  PENALTY_CANCELLED: 'PENALTY_CANCELLED',
  PENALTY_SCOPE_DENIED: 'PENALTY_SCOPE_DENIED',

  RECOVERY_CASE_LISTED: 'RECOVERY_CASE_LISTED',
  RECOVERY_CASE_VIEWED: 'RECOVERY_CASE_VIEWED',
  RECOVERY_CASE_OPENED: 'RECOVERY_CASE_OPENED',
  /**
   * Assignment and reassignment. The metadata carries the previous and the new
   * assignee, which is what Scenario 54 requires.
   */
  RECOVERY_CASE_ASSIGNED: 'RECOVERY_CASE_ASSIGNED',
  RECOVERY_CASE_REASSIGNED: 'RECOVERY_CASE_REASSIGNED',
  /** Refused because the chosen officer is inactive (Scenario 11). */
  RECOVERY_CASE_ASSIGNMENT_REFUSED: 'RECOVERY_CASE_ASSIGNMENT_REFUSED',
  RECOVERY_CASE_ESCALATED: 'RECOVERY_CASE_ESCALATED',
  RECOVERY_CASE_CLOSED: 'RECOVERY_CASE_CLOSED',
  /** Closure refused: mandatory obligations remain (Scenario 40). */
  RECOVERY_CASE_CLOSURE_BLOCKED: 'RECOVERY_CASE_CLOSURE_BLOCKED',
  /** An action was refused because the loan's state forbids it (Scenario 41). */
  RECOVERY_CASE_BLOCKED: 'RECOVERY_CASE_BLOCKED',
  RECOVERY_CASE_DELETE_BLOCKED: 'RECOVERY_CASE_DELETE_BLOCKED',
  RECOVERY_CASE_SCOPE_DENIED: 'RECOVERY_CASE_SCOPE_DENIED',
  RECOVERY_CASE_IDEMPOTENCY_CONFLICT: 'RECOVERY_CASE_IDEMPOTENCY_CONFLICT',
  RECOVERY_CASE_DUPLICATE_IGNORED: 'RECOVERY_CASE_DUPLICATE_IGNORED',
  RECOVERY_CASE_CONCURRENT_ATTEMPT_REJECTED:
    'RECOVERY_CASE_CONCURRENT_ATTEMPT_REJECTED',

  RECOVERY_ACTION_RECORDED: 'RECOVERY_ACTION_RECORDED',
  RECOVERY_ACTION_UPDATED: 'RECOVERY_ACTION_UPDATED',
  /** Edit or delete refused because the action is finalized (Scenarios 32, 35). */
  RECOVERY_ACTION_EDIT_BLOCKED: 'RECOVERY_ACTION_EDIT_BLOCKED',
  RECOVERY_ACTION_DELETE_BLOCKED: 'RECOVERY_ACTION_DELETE_BLOCKED',
  RECOVERY_PROMISE_RECORDED: 'RECOVERY_PROMISE_RECORDED',
  /** A promise-to-pay date passed with no authoritative payment (Scenario 16). */
  RECOVERY_PROMISE_MISSED: 'RECOVERY_PROMISE_MISSED',
  /**
   * Offline synchronization. `SYNC_CONFLICT` is the one that matters: a device
   * arrived with an activity that contradicts newer authoritative state, and
   * the newer state was kept (Scenario 29).
   */
  RECOVERY_SYNC_RECEIVED: 'RECOVERY_SYNC_RECEIVED',
  RECOVERY_SYNC_CONFLICT: 'RECOVERY_SYNC_CONFLICT',
  RECOVERY_SYNC_DUPLICATE_IGNORED: 'RECOVERY_SYNC_DUPLICATE_IGNORED',
  /** GPS evidence was required and the device could not obtain it (Scenario 30). */
  RECOVERY_GPS_CAPTURE_FAILED: 'RECOVERY_GPS_CAPTURE_FAILED',

  SETTLEMENT_PROPOSED: 'SETTLEMENT_PROPOSED',
  SETTLEMENT_APPROVED: 'SETTLEMENT_APPROVED',
  SETTLEMENT_REJECTED: 'SETTLEMENT_REJECTED',
  SETTLEMENT_COMPLETED: 'SETTLEMENT_COMPLETED',
  SETTLEMENT_LEDGER_POSTED: 'SETTLEMENT_LEDGER_POSTED',
  SETTLEMENT_POSTING_FAILED: 'SETTLEMENT_POSTING_FAILED',
  SETTLEMENT_SCOPE_DENIED: 'SETTLEMENT_SCOPE_DENIED',
  SETTLEMENT_IDEMPOTENCY_CONFLICT: 'SETTLEMENT_IDEMPOTENCY_CONFLICT',
  SETTLEMENT_CONCURRENT_ATTEMPT_REJECTED:
    'SETTLEMENT_CONCURRENT_ATTEMPT_REJECTED',

  LEGAL_NOTICE_ISSUED: 'LEGAL_NOTICE_ISSUED',
  LEGAL_NOTICE_SCOPE_DENIED: 'LEGAL_NOTICE_SCOPE_DENIED',

  LOAN_WRITTEN_OFF: 'LOAN_WRITTEN_OFF',
  LOAN_WRITE_OFF_LEDGER_POSTED: 'LOAN_WRITE_OFF_LEDGER_POSTED',
  LOAN_WRITE_OFF_FAILED: 'LOAN_WRITE_OFF_FAILED',
  /** NPA classification. Authorized, never automatic (Rule 29). */
  LOAN_NPA_CLASSIFIED: 'LOAN_NPA_CLASSIFIED',

  // --- Module 15: Reports & Analytics ---
  //
  // Reports write nothing to the business record, so unusually for this file
  // these actions describe *reads*. They are audited anyway, and Scenarios
  // 64-67 are why: a report is how data leaves the system in bulk, and knowing
  // who ran which report over which scope is the whole of the access trail.
  //
  // The failure and denial actions are recorded without a `tx`, so they survive
  // the rollback of whatever they are refusing.
  /** A report was generated. Records the category, scope and row count. */
  REPORT_GENERATED: 'REPORT_GENERATED',
  /** A report was downloaded as a file. Scenario 34, and Scenario 65 for PII. */
  REPORT_EXPORTED: 'REPORT_EXPORTED',
  /** An export was refused — permission, scope or size (Scenarios 35, 51, 62). */
  REPORT_EXPORT_DENIED: 'REPORT_EXPORT_DENIED',
  /** Generation failed. Scenario 32: never recorded as a completed report. */
  REPORT_GENERATION_FAILED: 'REPORT_GENERATION_FAILED',
  /** A report request named a branch outside the caller's scope (Scenario 50). */
  REPORT_SCOPE_DENIED: 'REPORT_SCOPE_DENIED',

  SAVED_REPORT_CREATED: 'SAVED_REPORT_CREATED',
  SAVED_REPORT_UPDATED: 'SAVED_REPORT_UPDATED',
  SAVED_REPORT_DEACTIVATED: 'SAVED_REPORT_DEACTIVATED',
  SAVED_REPORT_DELETED: 'SAVED_REPORT_DELETED',
  /** Deletion refused because something downstream references it (Scenario 42). */
  SAVED_REPORT_DELETE_BLOCKED: 'SAVED_REPORT_DELETE_BLOCKED',
  /** A stale edit was refused rather than overwriting a newer one (Scenario 59). */
  SAVED_REPORT_CONCURRENT_ATTEMPT_REJECTED:
    'SAVED_REPORT_CONCURRENT_ATTEMPT_REJECTED',
  SAVED_REPORT_LISTED: 'SAVED_REPORT_LISTED',

  // --- Module 16: Notifications ---
  //
  // Rule 73 asks for generation, delivery attempts, failures, retries,
  // read-state changes, permission denials and administrative actions to be
  // audited. Each distinct outcome gets its own action rather than one action
  // with a `reason` field, following this file's convention — a suppressed
  // notification and a failed one are different events, and an operator
  // filtering the audit trail should not have to read metadata to tell them
  // apart.
  //
  // Everything on the delivery path is recorded WITHOUT a `tx` and with the
  // call wrapped in `.catch(() => {})`. That is deliberate and load-bearing: a
  // failed audit write must never fail a delivery, and a recorded failure must
  // survive the rollback of the thing it is describing.

  /** An authoritative source event was accepted for processing (Scenario 22). */
  NOTIFICATION_EVENT_RECEIVED: 'NOTIFICATION_EVENT_RECEIVED',
  /**
   * The same event arrived twice and the second was ignored (Rule 22,
   * Scenario 23). Audited rather than silently dropped, because Scenario 23
   * requires the duplicate be *traceable* — this is where it is traced.
   */
  NOTIFICATION_EVENT_DUPLICATE_IGNORED: 'NOTIFICATION_EVENT_DUPLICATE_IGNORED',
  /** Generation failed for the whole event (Scenario 52). */
  NOTIFICATION_EVENT_PROCESSING_FAILED: 'NOTIFICATION_EVENT_PROCESSING_FAILED',
  /** An event matched no active rule. A valid state, not a failure. */
  NOTIFICATION_EVENT_UNMATCHED: 'NOTIFICATION_EVENT_UNMATCHED',

  /** A logical notification was created for one recipient (Rule 73). */
  NOTIFICATION_CREATED: 'NOTIFICATION_CREATED',
  /**
   * Created but never dispatched — a user preference, an inactive template or a
   * deactivated recipient (Scenarios 12, 20, 54). Distinct from FAILED: nothing
   * went wrong, the system decided not to send.
   */
  NOTIFICATION_SUPPRESSED: 'NOTIFICATION_SUPPRESSED',
  /**
   * A rule resolved no eligible recipient (Scenario 53). No notification is
   * created and none is sent to an arbitrary user; this record is the only
   * evidence the event was considered at all.
   */
  NOTIFICATION_RECIPIENT_UNRESOLVED: 'NOTIFICATION_RECIPIENT_UNRESOLVED',
  /** A template could not be rendered, so no notification was created (Scenario 52). */
  NOTIFICATION_RENDER_FAILED: 'NOTIFICATION_RENDER_FAILED',

  /** A delivery attempt was started (Rule 15, Scenario 57). */
  NOTIFICATION_DELIVERY_ATTEMPTED: 'NOTIFICATION_DELIVERY_ATTEMPTED',
  /**
   * A provider accepted the message (Rule 17, Scenario 27).
   * Named "accepted" and not "delivered" on purpose: the two are different
   * claims, and only the in-app channel can honestly make the second.
   */
  NOTIFICATION_DELIVERY_ACCEPTED: 'NOTIFICATION_DELIVERY_ACCEPTED',
  NOTIFICATION_DELIVERY_FAILED: 'NOTIFICATION_DELIVERY_FAILED',
  /** A retryable failure with a deterministic next attempt (Rule 21, Scenario 28). */
  NOTIFICATION_DELIVERY_RETRY_SCHEDULED:
    'NOTIFICATION_DELIVERY_RETRY_SCHEDULED',
  /**
   * Terminal. Either the failure was permanent (Scenario 29) or the attempt cap
   * was reached (Rule 20, Scenario 30). No further attempt will be scheduled.
   */
  NOTIFICATION_DELIVERY_PERMANENTLY_FAILED:
    'NOTIFICATION_DELIVERY_PERMANENTLY_FAILED',
  /** An administrator re-enqueued a failed delivery (Scenario 45). */
  NOTIFICATION_DELIVERY_RETRIED_MANUALLY:
    'NOTIFICATION_DELIVERY_RETRIED_MANUALLY',

  /**
   * Read-state transitions (Rule 73, Scenario 59).
   *
   * Audited because the specification asks for acknowledgement to be auditable
   * where the organization requires it, and a read receipt on an operational
   * alert is exactly that kind of evidence.
   */
  NOTIFICATION_READ: 'NOTIFICATION_READ',
  NOTIFICATION_UNREAD: 'NOTIFICATION_UNREAD',
  NOTIFICATION_ARCHIVED: 'NOTIFICATION_ARCHIVED',
  NOTIFICATION_LISTED: 'NOTIFICATION_LISTED',
  NOTIFICATION_VIEWED: 'NOTIFICATION_VIEWED',

  NOTIFICATION_TEMPLATE_CREATED: 'NOTIFICATION_TEMPLATE_CREATED',
  NOTIFICATION_TEMPLATE_UPDATED: 'NOTIFICATION_TEMPLATE_UPDATED',
  NOTIFICATION_TEMPLATE_ACTIVATED: 'NOTIFICATION_TEMPLATE_ACTIVATED',
  NOTIFICATION_TEMPLATE_DEACTIVATED: 'NOTIFICATION_TEMPLATE_DEACTIVATED',
  NOTIFICATION_TEMPLATE_DELETED: 'NOTIFICATION_TEMPLATE_DELETED',
  /** Deletion refused — referenced downstream, or a protected system template. */
  NOTIFICATION_TEMPLATE_DELETE_BLOCKED: 'NOTIFICATION_TEMPLATE_DELETE_BLOCKED',

  NOTIFICATION_RULE_CREATED: 'NOTIFICATION_RULE_CREATED',
  NOTIFICATION_RULE_UPDATED: 'NOTIFICATION_RULE_UPDATED',
  NOTIFICATION_RULE_DEACTIVATED: 'NOTIFICATION_RULE_DEACTIVATED',
  NOTIFICATION_RULE_DELETED: 'NOTIFICATION_RULE_DELETED',
  NOTIFICATION_RULE_DELETE_BLOCKED: 'NOTIFICATION_RULE_DELETE_BLOCKED',

  NOTIFICATION_PREFERENCES_UPDATED: 'NOTIFICATION_PREFERENCES_UPDATED',
  /** A stale update was refused rather than overwriting a newer one (Scenario 21). */
  NOTIFICATION_PREFERENCE_CONFLICT: 'NOTIFICATION_PREFERENCE_CONFLICT',

  /** A request named an organization or branch outside the caller's scope. */
  NOTIFICATION_SCOPE_DENIED: 'NOTIFICATION_SCOPE_DENIED',

  // --- Module 17: Settings, Audit & Maintenance ---
  //
  // Split by outcome rather than one action plus a reason field, the convention
  // this catalog follows throughout. Scenarios 67, 68 and 69 each ask for a
  // *different* audited outcome of the same attempted act — success, rejection
  // and denial — and a single SETTING_UPDATED action carrying `result: FAILED`
  // in metadata would make all three the same row to anyone filtering by action.
  SETTING_CREATED: 'SETTING_CREATED',
  SETTING_UPDATED: 'SETTING_UPDATED',
  SETTING_DELETED: 'SETTING_DELETED',
  SETTING_ACTIVATED: 'SETTING_ACTIVATED',
  SETTING_DEACTIVATED: 'SETTING_DEACTIVATED',
  /** Scenario 68 — a validation or registry refusal. */
  SETTING_REJECTED: 'SETTING_REJECTED',
  /** Scenario 7 — a stale `expectedVersion` lost the race. */
  SETTING_CONCURRENT_EDIT_REJECTED: 'SETTING_CONCURRENT_EDIT_REJECTED',
  /** Scenario 64 — protected setting, caller without the permission. */
  SETTING_PROTECTED_DENIED: 'SETTING_PROTECTED_DENIED',
  /** Scenarios 44, 46 — cross-branch or cross-organization reach. */
  SETTING_SCOPE_DENIED: 'SETTING_SCOPE_DENIED',
  /** Scenario 16 — deletion refused because something references it. */
  SETTING_DELETE_BLOCKED: 'SETTING_DELETE_BLOCKED',

  SETTING_CHANGE_SUBMITTED: 'SETTING_CHANGE_SUBMITTED',
  SETTING_CHANGE_APPROVED: 'SETTING_CHANGE_APPROVED',
  SETTING_CHANGE_REJECTED: 'SETTING_CHANGE_REJECTED',
  SETTING_CHANGE_CANCELLED: 'SETTING_CHANGE_CANCELLED',
  SETTING_CHANGE_APPLIED: 'SETTING_CHANGE_APPLIED',
  /** Scenario 63 — approved, then failed its apply-time revalidation. */
  SETTING_CHANGE_APPLY_FAILED: 'SETTING_CHANGE_APPLY_FAILED',
  /** Scenario 11 — the maker tried to approve their own change. */
  SETTING_CHANGE_SELF_APPROVAL_DENIED: 'SETTING_CHANGE_SELF_APPROVAL_DENIED',
  /** Scenario 13 — a terminal change request was asked to move again. */
  SETTING_CHANGE_TERMINAL_TRANSITION_REJECTED:
    'SETTING_CHANGE_TERMINAL_TRANSITION_REJECTED',

  BUSINESS_CALENDAR_UPDATED: 'BUSINESS_CALENDAR_UPDATED',
  BUSINESS_CALENDAR_REJECTED: 'BUSINESS_CALENDAR_REJECTED',
  CALENDAR_HOLIDAY_ADDED: 'CALENDAR_HOLIDAY_ADDED',
  CALENDAR_HOLIDAY_REMOVED: 'CALENDAR_HOLIDAY_REMOVED',

  /** Reading the trail is audited; Rule 88 admits no exception for audit itself. */
  AUDIT_EXPORTED: 'AUDIT_EXPORTED',
  /** Scenario 42 — export attempted without the permission or beyond bounds. */
  AUDIT_EXPORT_DENIED: 'AUDIT_EXPORT_DENIED',

  MAINTENANCE_JOB_STARTED: 'MAINTENANCE_JOB_STARTED',
  MAINTENANCE_JOB_SUCCEEDED: 'MAINTENANCE_JOB_SUCCEEDED',
  MAINTENANCE_JOB_FAILED: 'MAINTENANCE_JOB_FAILED',
  MAINTENANCE_JOB_RETRIED: 'MAINTENANCE_JOB_RETRIED',
  /**
   * Scenarios 22 and 66 — a duplicate request recognised as already running or
   * already done. Distinct from STARTED because no new work began, and distinct
   * from a failure because nothing went wrong: idempotent recognition is the
   * designed outcome, and it must be visible as such.
   */
  MAINTENANCE_JOB_DUPLICATE_IGNORED: 'MAINTENANCE_JOB_DUPLICATE_IGNORED',
  /** Scenario 31 — terminal, non-retryable; no automatic retry continues. */
  MAINTENANCE_JOB_RECOVERY_REQUIRED: 'MAINTENANCE_JOB_RECOVERY_REQUIRED',
  /** Scenarios 45, 65 — job requested for a branch outside the caller's reach. */
  MAINTENANCE_SCOPE_DENIED: 'MAINTENANCE_SCOPE_DENIED',

  MAINTENANCE_MODE_ENABLED: 'MAINTENANCE_MODE_ENABLED',
  MAINTENANCE_MODE_DISABLED: 'MAINTENANCE_MODE_DISABLED',
  /** Rule 79 — an operation refused because maintenance mode is on. */
  MAINTENANCE_MODE_BLOCKED_OPERATION: 'MAINTENANCE_MODE_BLOCKED_OPERATION',

  // --- Module 18: Dashboard & Home ---
  //
  // Four actions, and one notable absence. `PermissionsGuard` already writes
  // AUTHZ_PERMISSION_DENIED for anyone lacking `dashboard.view`, so there is no
  // DASHBOARD_ACCESS_DENIED here — adding one would double-log the same refusal
  // and make the two disagree the first time a guard changed.
  //
  // What the guard cannot see is a refusal the dashboard decides for itself: a
  // widget whose owning-module permission is missing, and a branch the caller
  // may not read. Those are the two *_DENIED actions below, and they are split
  // because they answer different questions — "who is looking at things they
  // may not see" versus "who is probing other branches" (Scenarios 7, 9, 46).
  /** Scenario 45 — the home screen was opened and its layout resolved. */
  DASHBOARD_VIEWED: 'DASHBOARD_VIEWED',
  /** Scenario 45 — one widget's data was served. */
  DASHBOARD_WIDGET_VIEWED: 'DASHBOARD_WIDGET_VIEWED',
  /**
   * Scenario 36 — a widget's source failed. Audited rather than only logged:
   * a widget that is failing for one branch and not others is an operational
   * fact, and the log alone cannot be queried alongside who saw it.
   */
  DASHBOARD_WIDGET_FAILED: 'DASHBOARD_WIDGET_FAILED',
  /** Scenarios 9, 46 — a widget requested without the owning module's permission. */
  DASHBOARD_WIDGET_DENIED: 'DASHBOARD_WIDGET_DENIED',
  /** Scenarios 7, 46 — a branch requested that the caller's scope does not reach. */
  DASHBOARD_SCOPE_DENIED: 'DASHBOARD_SCOPE_DENIED',
} as const;

export interface AuditInput {
  /** Required: part of the AuditLog composite primary key. */
  orgId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  /**
   * The branch the audited event *belongs to* — not necessarily the actor's
   * branch, since a head-office user acting on a branch record produces an event
   * scoped to that branch (Module 17, Rule 34).
   *
   * Optional, and NULL means "not branch-attributed" rather than "unknown at
   * organization level". Retrofitted in Module 17, so most call sites still omit
   * it; `AuditQueryService` therefore falls back to the actor's branch for NULL
   * rows rather than hiding them. Deliberately carries no foreign key to
   * `branches` — audit evidence must survive deletion of the branch it
   * describes.
   */
  branchId?: string | null;
  /**
   * Must be null unless a real `users` row exists for this org — the column
   * carries a composite FK (org_id, actor_user_id) -> users(org_id, user_id),
   * so writing an attempted-but-unknown id raises a FK violation.
   */
  actorUserId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Before/after snapshots for a record-changing action, written to the
   * `old_data` / `new_data` columns.
   *
   * Separate from `metadata` because they answer a different question: metadata
   * describes the circumstances of the event, these describe the change itself.
   * Module 02 Scenario 52 requires an auditor be able to see previous and
   * current values, and keeping them in dedicated columns means that query does
   * not have to reach inside a free-form JSON blob.
   *
   * Both pass through the same sensitive-key filter as metadata.
   */
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
}

/** Keys whose values must never reach an audit record. */
const SENSITIVE_KEY = /pass|pwd|secret|token|hash|credential/i;

/**
 * Defence-in-depth backstop for the story's "password is never logged" rules
 * (Scenarios 20, 33, 34, 35). Callers are not supposed to pass secrets, but a
 * single careless spread should not put a plaintext password in the database.
 *
 * Note for callers: the filter matches on key *name*, not value, so a harmless
 * key that happens to contain "token" or "hash" is dropped too. Recovery
 * metadata therefore identifies a request as `recoveryRef` (its non-secret
 * requestId UUID) rather than `resetToken` or `tokenId`, which would silently
 * vanish and leave the audit record untraceable.
 */
export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * Masks a mobile number for audit metadata: 9876543210 -> 98XXXXXX10.
 *
 * A failed sign-in still needs to be traceable, but storing the full attempted
 * mobile would leak the identifier of a non-consenting third party.
 */
export function maskMobile(mobile: string): string {
  if (mobile.length < 4) return 'X'.repeat(mobile.length);
  return `${mobile.slice(0, 2)}${'X'.repeat(mobile.length - 4)}${mobile.slice(-2)}`;
}

/**
 * The single writer for `audit_logs`.
 *
 * Centralised because `AuditLog.occurredAt` has no database default — every
 * insert must supply it, so leaving that to call sites guarantees an eventual
 * runtime failure.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `tx` should be supplied whenever the audit record must commit or roll back
   * with the surrounding business operation.
   */
  async record(
    input: AuditInput,
    tx?: Pick<PrismaService, 'auditLog'>,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    await client.auditLog.create({
      data: {
        orgId: input.orgId,
        occurredAt: new Date(),
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        branchId: input.branchId ?? null,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        // Cast to Prisma's JSON input type: the sanitised object is a plain
        // JSON-serialisable record, which `InputJsonValue` cannot express as an
        // open Record<string, unknown>.
        metadata: sanitizeMetadata(input.metadata) as
          Record<string, never> | undefined,
        oldData: sanitizeMetadata(input.oldData) as
          Record<string, never> | undefined,
        newData: sanitizeMetadata(input.newData) as
          Record<string, never> | undefined,
      },
    });
  }

  /**
   * Security event that cannot be written to `audit_logs`.
   *
   * When the submitted organization code matches no organization there is no
   * `orgId`, and `orgId` is both part of the audit primary key and a foreign
   * key — so no row can exist. Such attempts are recorded to the application
   * log instead. This is a documented deviation from "every attempt is audit
   * logged"; the story assumes a resolvable tenant.
   */
  recordUnresolvableTenant(details: {
    orgCode: string;
    maskedMobile: string;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): void {
    this.logger.warn({
      event: 'AUTH_LOGIN_UNKNOWN_ORG',
      ...details,
    });
  }
}
