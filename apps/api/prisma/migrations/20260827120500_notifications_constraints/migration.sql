-- Module 16 — Notifications: CHECK constraints
--
-- Separate from 20260827120000_notifications purely because of Postgres enum
-- semantics: a value added by `ALTER TYPE ... ADD VALUE` cannot be *read* in
-- the transaction that added it, and Prisma runs each migration inside one.
-- Every constraint below references a value that migration added, so they wait
-- for it to commit. Merging the two files produces
-- "unsafe use of new value ... of enum type" at deploy time.
--
-- These are CHECK constraints rather than validation-only rules because each
-- one guards an invariant whose violation surfaces far from its cause. A rule
-- that cannot resolve a recipient does not fail at configuration time; it fails
-- silently at 2 a.m. when the event fires and Scenario 53's "no eligible
-- recipient" path swallows it. The database is the right place to refuse.

-- ---------------------------------------------------------------------------
-- notification_event_rules — recipient strategy coherence (Rule 42)
-- ---------------------------------------------------------------------------

-- Each strategy needs the field it resolves through. Without these, a rule can
-- be saved that names ROLE and carries no role code, and the failure appears
-- only as an unexplained absence of notifications.
ALTER TABLE "notification_event_rules"
  ADD CONSTRAINT "notification_event_rules_strategy_fields"
  CHECK (
    CASE "recipient_strategy"
      WHEN 'ROLE' THEN "recipient_role_code" IS NOT NULL
      WHEN 'BRANCH_USER_GROUP' THEN "recipient_permission_code" IS NOT NULL
      WHEN 'EXPLICIT' THEN array_length("explicit_recipient_user_ids", 1) IS NOT NULL
      -- ASSIGNED_USER and RECORD_OWNER resolve from the source record itself
      -- and carry no configuration field of their own.
      ELSE true
    END
  );

-- Rules 19-21: retry policy must be able to terminate. A zero or negative
-- attempt cap would mean "never deliver"; an unbounded one is Rule 20's
-- "retry indefinitely", which the specification forbids outright.
ALTER TABLE "notification_event_rules"
  ADD CONSTRAINT "notification_event_rules_retry_bounds"
  CHECK (
    "max_attempts" >= 1
    AND "max_attempts" <= 10
    AND "backoff_base_seconds" >= 1
    AND "backoff_base_seconds" <= 3600
  );

-- Only the three channels Module 16 ships may be configured. PUSH and AUTO_CALL
-- remain in the enum because dropping an enum value rewrites the type, but no
-- rule may select one — a rule targeting a channel with no provider would
-- accumulate permanent failures rather than failing at configuration time.
ALTER TABLE "notification_event_rules"
  ADD CONSTRAINT "notification_event_rules_supported_channel"
  CHECK ("channel" IN ('IN_APP', 'EMAIL', 'SMS'));

-- ---------------------------------------------------------------------------
-- notification_templates — channel and PII policy (Rules 55, 56)
-- ---------------------------------------------------------------------------

ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_supported_channel"
  CHECK ("channel" IN ('IN_APP', 'EMAIL', 'SMS'));

-- Rules 55 and 56: SMS and email content must not carry unnecessary sensitive
-- data. The renderer enforces this too, but stating it here means a template
-- seeded or imported outside the service cannot bypass it.
ALTER TABLE "notification_templates"
  ADD CONSTRAINT "notification_templates_pii_channel_policy"
  CHECK (NOT ("contains_pii" AND "channel" IN ('SMS', 'EMAIL')));

-- ---------------------------------------------------------------------------
-- notifications — status coherence
-- ---------------------------------------------------------------------------

-- Scenario 20: a suppressed notification records *why*. Without this, a
-- SUPPRESSED row with no reason is indistinguishable from a bug, and the
-- suppression outcome the scenario asks to be recorded is simply absent.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_suppression_reason_present"
  CHECK (
    ("status" = 'SUPPRESSED' AND "suppression_reason" IS NOT NULL)
    OR ("status" <> 'SUPPRESSED' AND "suppression_reason" IS NULL)
  );

-- Rules 51, 52: read state is a pair. A row marked read with no timestamp
-- cannot answer "when", and a read timestamp on an unread row is contradictory.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_read_state_coherent"
  CHECK (("read_status" AND "read_at" IS NOT NULL) OR (NOT "read_status" AND "read_at" IS NULL));

-- A notification must reach exactly one recipient. Module 16's audience is
-- internal staff, so recipient_user_id is always the populated one; the
-- customer column is kept for a later borrower-facing module and this
-- constraint is what stops both being set at once when that arrives.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_single_recipient"
  CHECK (
    ("recipient_user_id" IS NOT NULL AND "recipient_customer_id" IS NULL)
    OR ("recipient_user_id" IS NULL AND "recipient_customer_id" IS NOT NULL)
  );

-- Rule 17 and Scenario 27: SENT means handed off, and only then is sent_at
-- meaningful. Recording a send time on a notification that never left is the
-- false claim the rule forbids.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_sent_at_requires_sent"
  CHECK ("sent_at" IS NULL OR "status" IN ('SENT', 'ARCHIVED'));

-- ---------------------------------------------------------------------------
-- notification_deliveries — attempt and retry coherence
-- ---------------------------------------------------------------------------

-- Attempts are 1-based and monotonic; attempt 0 would collide with the unique
-- index's meaning of "first try".
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_attempt_positive"
  CHECK ("attempt_number" >= 1);

-- Rules 19, 20 and Scenarios 28-30: only a scheduled retry has a next attempt
-- time. A PERMANENT_FAILURE carrying next_retry_at is exactly the state that
-- would let a sweep retry something that must never be retried again.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_retry_scheduling"
  CHECK (
    ("status" = 'RETRY_SCHEDULED' AND "next_retry_at" IS NOT NULL)
    OR ("status" <> 'RETRY_SCHEDULED' AND "next_retry_at" IS NULL)
  );

-- Rule 17 and Scenario 27, stated as a constraint: DELIVERED is reachable only
-- for IN_APP, where the LMS itself completes the delivery. An external provider
-- accepting a message maps to ACCEPTED_BY_PROVIDER. This is the single rule
-- most likely to be undone by a well-meaning refactor, so it is enforced here
-- rather than left to the dispatch service alone.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_delivered_only_in_app"
  CHECK (NOT ("status" = 'DELIVERED' AND "channel" <> 'IN_APP'));

-- A failure classification belongs with a failure.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_failure_code_with_failure"
  CHECK (
    "failure_code" IS NULL
    OR "status" IN ('FAILED', 'RETRY_SCHEDULED', 'PERMANENT_FAILURE')
  );
