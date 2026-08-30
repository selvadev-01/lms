-- Security events that belong to no tenant.
--
-- audit_logs cannot hold these: org_id is half its primary key AND a foreign
-- key to organizations, so an event whose whole point is that no organization
-- resolved has nowhere to go. Sign-in attempts against an unknown org code and
-- rejected signups were written to the application log only, leaving credential
-- stuffing against invented org codes with no queryable trail.
--
-- Deliberately has NO foreign key to organizations: org_code here is an
-- attacker-supplied string that usually matches nothing, and a foreign key
-- would recreate the very constraint that forced the omission.
CREATE TABLE "untenanted_audit_logs" (
    "audit_id"      UUID         NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "action"        VARCHAR(150) NOT NULL,
    "org_code"      VARCHAR(100),
    "masked_mobile" VARCHAR(20),
    "request_id"    UUID,
    "ip_address"    INET,
    "user_agent"    TEXT,
    "metadata"      JSONB,

    CONSTRAINT "untenanted_audit_logs_pkey" PRIMARY KEY ("audit_id")
);

-- "What came from this address" is the question this table exists to answer.
CREATE INDEX "untenanted_audit_logs_ip_address_occurred_at_idx"
    ON "untenanted_audit_logs" ("ip_address", "occurred_at");

CREATE INDEX "untenanted_audit_logs_occurred_at_idx"
    ON "untenanted_audit_logs" ("occurred_at");

CREATE INDEX "untenanted_audit_logs_action_occurred_at_idx"
    ON "untenanted_audit_logs" ("action", "occurred_at");
