/**
 * Module 16 — the notification templates and event rules a fresh organization
 * starts with.
 *
 * Extracted from `seed.ts` rather than inlined: that file is already 1,700
 * lines, and this is the one part of it a business administrator is expected to
 * read and change.
 *
 * # Which notifications are mandatory
 *
 * The specification's open question asked, and the answer this seed commits to
 * is one sentence worth remembering:
 *
 *   **Money-moving, security and assignment events are mandatory; informational
 *   status changes are optional.**
 *
 * A mandatory rule ignores personal preferences entirely (Rules 47, 48), so the
 * bar is deliberately high: a notification is mandatory when someone else's
 * money or accountability depends on it being seen. An approval nobody sees is
 * an operational failure; a disbursal confirmation is a courtesy.
 *
 * # Which channels carry what
 *
 * IN_APP carries loan numbers, amounts and customer names — it is inside the
 * authenticated session, so Rule 55's "controlled by channel policy" permits
 * it.
 *
 * SMS carries none of those. Rules 55 and 56 keep unnecessary sensitive data
 * off external channels, and the three SMS templates below are written to be
 * useful without them: they say *that* something needs attention and where to
 * look, never who or how much. `containsPii: false` on every one of them is
 * therefore a statement about the text, enforced by a CHECK constraint and by
 * the renderer.
 *
 * EMAIL is seeded for the two events where a recipient may not be in the
 * application when it happens.
 *
 * # Why these are system templates
 *
 * `isSystem: true` makes them editable but never deletable (Rule 33). An
 * organization that deleted its own approval template would silently stop
 * notifying approvers, and the failure would look like a delivery bug.
 */

export interface TemplateSpec {
  code: string;
  name: string;
  category: string;
  sourceModule: string;
  eventType: string;
  channel: 'IN_APP' | 'EMAIL' | 'SMS';
  subject?: string;
  titleTemplate?: string;
  body: string;
  containsPii: boolean;
}

export interface RuleSpec {
  name: string;
  eventType: string;
  sourceModule: string;
  sourceTrigger: string;
  templateCode: string;
  channel: 'IN_APP' | 'EMAIL' | 'SMS';
  recipientStrategy:
    | 'ROLE'
    | 'ASSIGNED_USER'
    | 'RECORD_OWNER'
    | 'BRANCH_USER_GROUP'
    | 'EXPLICIT';
  recipientRoleCode?: string;
  recipientPermissionCode?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  isMandatory: boolean;
}

/**
 * Every token used below must exist in the payload the source module emits.
 * An unresolved token throws at render time and the event is recorded as
 * failed (Scenario 52) — deliberately loud, because a message reading
 * "Case undefined assigned" is worse than no message.
 */
export const NOTIFICATION_TEMPLATE_SPECS: readonly TemplateSpec[] = [
  // --- Approval ------------------------------------------------------------
  {
    code: 'APPROVAL_REQUESTED_IN_APP',
    name: 'Approval requested (in-app)',
    category: 'APPROVAL',
    sourceModule: 'approval',
    eventType: 'APPROVAL_REQUESTED',
    channel: 'IN_APP',
    titleTemplate: 'Application {{applicationNumber}} needs approval',
    body: '{{customerName}} has applied for {{amountFormatted}}. Application {{applicationNumber}} is waiting for a decision.',
    containsPii: true,
  },
  {
    code: 'APPROVAL_REQUESTED_EMAIL',
    name: 'Approval requested (email)',
    category: 'APPROVAL',
    sourceModule: 'approval',
    eventType: 'APPROVAL_REQUESTED',
    channel: 'EMAIL',
    subject: 'Loan application {{applicationNumber}} is awaiting approval',
    // No customer name, no amount: an approver's inbox is outside the
    // authenticated session (Rules 55, 56).
    body: 'Application {{applicationNumber}} is waiting for a decision. Sign in to the LMS to review it.',
    containsPii: false,
  },
  {
    code: 'APPROVAL_APPROVED_IN_APP',
    name: 'Application approved (in-app)',
    category: 'APPROVAL',
    sourceModule: 'approval',
    eventType: 'APPROVAL_APPROVED',
    channel: 'IN_APP',
    titleTemplate: 'Application {{applicationNumber}} approved',
    body: 'The application for {{customerName}} ({{amountFormatted}}) has been approved.',
    containsPii: true,
  },
  {
    code: 'APPROVAL_REJECTED_IN_APP',
    name: 'Application rejected (in-app)',
    category: 'APPROVAL',
    sourceModule: 'approval',
    eventType: 'APPROVAL_REJECTED',
    channel: 'IN_APP',
    titleTemplate: 'Application {{applicationNumber}} rejected',
    body: 'The application for {{customerName}} was rejected. Reason: {{rejectionReason}}',
    containsPii: true,
  },
  {
    code: 'APPLICATION_RETURNED_IN_APP',
    name: 'Application returned for more information (in-app)',
    category: 'APPLICATION',
    sourceModule: 'approval',
    eventType: 'APPLICATION_RETURNED',
    channel: 'IN_APP',
    titleTemplate: 'Application {{applicationNumber}} needs more information',
    body: '{{comments}}',
    containsPii: true,
  },

  // --- Disbursal -----------------------------------------------------------
  {
    code: 'DISBURSAL_COMPLETED_IN_APP',
    name: 'Disbursal completed (in-app)',
    category: 'DISBURSAL',
    sourceModule: 'disbursal',
    eventType: 'DISBURSAL_COMPLETED',
    channel: 'IN_APP',
    titleTemplate: 'Loan {{loanNumber}} disbursed',
    body: '{{amountFormatted}} was disbursed on {{disbursedOn}} against application {{applicationNumber}}.',
    containsPii: true,
  },

  // --- Collection ----------------------------------------------------------
  {
    code: 'RECEIPT_REVERSED_IN_APP',
    name: 'Receipt reversed (in-app)',
    category: 'COLLECTION',
    sourceModule: 'collection',
    eventType: 'RECEIPT_REVERSED',
    channel: 'IN_APP',
    titleTemplate: 'Receipt {{receiptNumber}} reversed',
    // Scenario 34's corrective notification. It names the original receipt so
    // the reversal is traceable to what it reversed, and never edits the
    // original notification.
    body: '{{amountFormatted}} on loan {{loanNumber}} was reversed by {{reversalReceiptNumber}}. Reason: {{reversalReason}}',
    containsPii: true,
  },

  // --- EMI reminders -------------------------------------------------------
  {
    code: 'EMI_DUE_TOMORROW_IN_APP',
    name: 'EMI due tomorrow (in-app)',
    category: 'EMI',
    sourceModule: 'repayment_schedule',
    eventType: 'EMI_DUE_TOMORROW',
    channel: 'IN_APP',
    titleTemplate: 'EMI due tomorrow on {{loanNumber}}',
    body: 'Instalment {{installmentNumber}} of {{amountFormatted}} is due on {{dueDate}} for {{customerName}}.',
    containsPii: true,
  },
  {
    code: 'EMI_DUE_TOMORROW_SMS',
    name: 'EMI due tomorrow (SMS)',
    category: 'EMI',
    sourceModule: 'repayment_schedule',
    eventType: 'EMI_DUE_TOMORROW',
    channel: 'SMS',
    // No name, no amount, no loan number. Enough to prompt action, nothing a
    // stranger reading the handset learns from (Rules 55, 56).
    body: 'LMS: you have a collection due tomorrow. Sign in to see the day list.',
    containsPii: false,
  },
  {
    code: 'EMI_OVERDUE_IN_APP',
    name: 'EMI overdue (in-app)',
    category: 'OVERDUE',
    sourceModule: 'overdue',
    eventType: 'EMI_OVERDUE',
    channel: 'IN_APP',
    titleTemplate: '{{loanNumber}} is {{daysPastDue}} days overdue',
    body: 'Instalment {{installmentNumber}} of {{amountFormatted}} was due on {{dueDate}} for {{customerName}}.',
    containsPii: true,
  },
  {
    code: 'EMI_OVERDUE_SMS',
    name: 'EMI overdue (SMS)',
    category: 'OVERDUE',
    sourceModule: 'overdue',
    eventType: 'EMI_OVERDUE',
    channel: 'SMS',
    body: 'LMS: an account you collect on is overdue. Sign in for details.',
    containsPii: false,
  },

  // --- Recovery ------------------------------------------------------------
  {
    code: 'RECOVERY_ASSIGNED_IN_APP',
    name: 'Recovery case assigned (in-app)',
    category: 'RECOVERY',
    sourceModule: 'recovery',
    eventType: 'RECOVERY_ASSIGNED',
    channel: 'IN_APP',
    titleTemplate: 'Case {{caseNumber}} assigned to you',
    body: 'Recovery case {{caseNumber}} on loan {{loanNumber}} for {{customerName}} is now yours. Priority: {{priority}}.',
    containsPii: true,
  },
  {
    code: 'RECOVERY_ASSIGNED_SMS',
    name: 'Recovery case assigned (SMS)',
    category: 'RECOVERY',
    sourceModule: 'recovery',
    eventType: 'RECOVERY_ASSIGNED',
    channel: 'SMS',
    // The case number alone: it identifies the work without naming the
    // borrower or the amount.
    body: 'LMS: recovery case {{caseNumber}} has been assigned to you.',
    containsPii: false,
  },
  {
    code: 'PROMISE_TO_PAY_MISSED_IN_APP',
    name: 'Promise to pay missed (in-app)',
    category: 'RECOVERY',
    sourceModule: 'recovery',
    eventType: 'PROMISE_TO_PAY_MISSED',
    channel: 'IN_APP',
    titleTemplate: 'Promise missed on case {{caseNumber}}',
    body: '{{customerName}} promised {{amountFormatted}} by {{promiseDate}} on loan {{loanNumber}}. No payment has been recorded.',
    containsPii: true,
  },

  // --- Cash ----------------------------------------------------------------
  {
    code: 'CASH_SHORTAGE_IN_APP',
    name: 'Cash shortage (in-app)',
    category: 'FIELD_COLLECTION',
    sourceModule: 'cash',
    eventType: 'CASH_SHORTAGE',
    channel: 'IN_APP',
    titleTemplate: 'Cash shortage on {{reconciliationNumber}}',
    body: 'Counted {{actualPaise}} paise against {{expectedPaise}} expected on {{businessDate}} at {{branchName}}. Difference {{differenceFormatted}}.',
    containsPii: true,
  },
  {
    code: 'CASH_EXCESS_IN_APP',
    name: 'Cash excess (in-app)',
    category: 'FIELD_COLLECTION',
    sourceModule: 'cash',
    eventType: 'CASH_EXCESS',
    channel: 'IN_APP',
    titleTemplate: 'Cash excess on {{reconciliationNumber}}',
    body: 'Counted {{actualPaise}} paise against {{expectedPaise}} expected on {{businessDate}} at {{branchName}}. Difference {{differenceFormatted}}.',
    containsPii: true,
  },
] as const;

/**
 * The rules that connect those templates to events.
 *
 * `sourceTrigger` names the state change in the owning module's own words. It
 * is documentation on the row rather than something the pipeline matches on —
 * matching is by `eventType` — but an administrator reading a rule list needs
 * to know *when* a rule fires, not just what it fires about.
 */
export const NOTIFICATION_RULE_SPECS: readonly RuleSpec[] = [
  // Mandatory: an approval nobody sees is an operational failure, and Rule 47
  // exists for exactly this case.
  {
    name: 'Approval requested notifies branch administrators',
    eventType: 'APPROVAL_REQUESTED',
    sourceModule: 'approval',
    sourceTrigger: 'submitted_for_approval',
    templateCode: 'APPROVAL_REQUESTED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'ROLE',
    recipientRoleCode: 'BRANCH_ADMIN',
    priority: 'HIGH',
    isMandatory: true,
  },
  {
    name: 'Approval requested emails branch administrators',
    eventType: 'APPROVAL_REQUESTED',
    sourceModule: 'approval',
    sourceTrigger: 'submitted_for_approval',
    templateCode: 'APPROVAL_REQUESTED_EMAIL',
    channel: 'EMAIL',
    recipientStrategy: 'ROLE',
    recipientRoleCode: 'BRANCH_ADMIN',
    priority: 'HIGH',
    isMandatory: true,
  },

  // Optional: the decision is already visible on the application, and whoever
  // raised it is not blocked by not hearing.
  {
    name: 'Approval decision notifies the application owner',
    eventType: 'APPROVAL_APPROVED',
    sourceModule: 'approval',
    sourceTrigger: 'approved',
    templateCode: 'APPROVAL_APPROVED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'RECORD_OWNER',
    priority: 'NORMAL',
    isMandatory: false,
  },
  {
    name: 'Rejection notifies the application owner',
    eventType: 'APPROVAL_REJECTED',
    sourceModule: 'approval',
    sourceTrigger: 'rejected',
    templateCode: 'APPROVAL_REJECTED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'RECORD_OWNER',
    priority: 'NORMAL',
    isMandatory: false,
  },
  {
    name: 'Returned application notifies its owner',
    eventType: 'APPLICATION_RETURNED',
    sourceModule: 'approval',
    sourceTrigger: 'more_info_requested',
    templateCode: 'APPLICATION_RETURNED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'RECORD_OWNER',
    priority: 'NORMAL',
    isMandatory: false,
  },
  {
    name: 'Disbursal completion notifies the application owner',
    eventType: 'DISBURSAL_COMPLETED',
    sourceModule: 'disbursal',
    sourceTrigger: 'confirmed',
    templateCode: 'DISBURSAL_COMPLETED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'RECORD_OWNER',
    priority: 'NORMAL',
    isMandatory: false,
  },

  // Mandatory: money moved back out. Scenario 34's corrective notification.
  {
    name: 'Receipt reversal notifies branch administrators',
    eventType: 'RECEIPT_REVERSED',
    sourceModule: 'collection',
    sourceTrigger: 'reversed',
    templateCode: 'RECEIPT_REVERSED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'ROLE',
    recipientRoleCode: 'BRANCH_ADMIN',
    priority: 'HIGH',
    isMandatory: true,
  },

  // Optional: a collector who does not want a day-ahead nudge can turn it off.
  // BRANCH_USER_GROUP rather than ROLE so it follows the permission that
  // actually defines the work, not a role name an organization may rename.
  {
    name: 'EMI due tomorrow notifies collectors',
    eventType: 'EMI_DUE_TOMORROW',
    sourceModule: 'repayment_schedule',
    sourceTrigger: 'due_tomorrow',
    templateCode: 'EMI_DUE_TOMORROW_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'BRANCH_USER_GROUP',
    recipientPermissionCode: 'collections.record',
    priority: 'NORMAL',
    isMandatory: false,
  },
  {
    name: 'Overdue instalment notifies collectors',
    eventType: 'EMI_OVERDUE',
    sourceModule: 'overdue',
    sourceTrigger: 'overdue_cadence',
    templateCode: 'EMI_OVERDUE_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'BRANCH_USER_GROUP',
    recipientPermissionCode: 'collections.record',
    priority: 'HIGH',
    isMandatory: false,
  },

  // Mandatory: an officer who does not know a case is theirs cannot work it,
  // and the case is measured against them either way (Scenarios 16, 38).
  {
    name: 'Recovery assignment notifies the assigned officer',
    eventType: 'RECOVERY_ASSIGNED',
    sourceModule: 'recovery',
    sourceTrigger: 'case_assigned',
    templateCode: 'RECOVERY_ASSIGNED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'ASSIGNED_USER',
    priority: 'HIGH',
    isMandatory: true,
  },
  {
    name: 'Recovery assignment texts the assigned officer',
    eventType: 'RECOVERY_ASSIGNED',
    sourceModule: 'recovery',
    sourceTrigger: 'case_assigned',
    templateCode: 'RECOVERY_ASSIGNED_SMS',
    channel: 'SMS',
    recipientStrategy: 'ASSIGNED_USER',
    priority: 'HIGH',
    isMandatory: true,
  },

  // Mandatory: Scenario 39. The officer who took the promise is accountable
  // for chasing it, and this is the only thing that tells them it lapsed.
  {
    name: 'Missed promise notifies the assigned officer',
    eventType: 'PROMISE_TO_PAY_MISSED',
    sourceModule: 'recovery',
    sourceTrigger: 'promise_lapsed',
    templateCode: 'PROMISE_TO_PAY_MISSED_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'ASSIGNED_USER',
    priority: 'HIGH',
    isMandatory: true,
  },

  // Mandatory both ways: a shortage is a control failure and an excess is
  // unexplained money. Neither is something a branch administrator may opt out
  // of hearing about.
  {
    name: 'Cash shortage notifies branch administrators',
    eventType: 'CASH_SHORTAGE',
    sourceModule: 'cash',
    sourceTrigger: 'reconciliation_discrepancy',
    templateCode: 'CASH_SHORTAGE_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'ROLE',
    recipientRoleCode: 'BRANCH_ADMIN',
    priority: 'CRITICAL',
    isMandatory: true,
  },
  {
    name: 'Cash excess notifies branch administrators',
    eventType: 'CASH_EXCESS',
    sourceModule: 'cash',
    sourceTrigger: 'reconciliation_discrepancy',
    templateCode: 'CASH_EXCESS_IN_APP',
    channel: 'IN_APP',
    recipientStrategy: 'ROLE',
    recipientRoleCode: 'BRANCH_ADMIN',
    priority: 'HIGH',
    isMandatory: true,
  },
] as const;
