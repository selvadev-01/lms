-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "branch_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'INACTIVE', 'LOCKED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "role_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "customer_type" AS ENUM ('KYC', 'LOCAL');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('PENDING', 'SUBMITTED', 'REVISION_REQUIRED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "document_verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "consent_status" AS ENUM ('PENDING', 'GIVEN', 'REJECTED');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "loan_type" AS ENUM ('PERSONAL', 'BUSINESS', 'GOLD', 'VEHICLE');

-- CreateEnum
CREATE TYPE "interest_type" AS ENUM ('FLAT', 'REDUCING', 'CUSTOM_RATE');

-- CreateEnum
CREATE TYPE "repayment_frequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "loan_product_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "loan_scheme_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "application_status" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED', 'REJECTED', 'APPROVED', 'SANCTIONED', 'CUSTOMER_ACCEPTED', 'CUSTOMER_REJECTED', 'AGREEMENT_SIGNED', 'DISBURSEMENT_PENDING', 'DISBURSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "loan_status" AS ENUM ('DRAFT', 'APPROVED', 'SANCTIONED', 'AGREEMENT_PENDING', 'AGREEMENT_SIGNED', 'DISBURSEMENT_PENDING', 'ACTIVE', 'OVERDUE', 'LEGAL_ESCALATION', 'RESTRUCTURED', 'CLOSURE_PENDING', 'CLOSED', 'WRITTEN_OFF', 'REJECTED');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "application_review_type" AS ENUM ('BRANCH_REVIEW', 'CREDIT_REVIEW', 'FINAL_APPROVAL');

-- CreateEnum
CREATE TYPE "application_review_decision" AS ENUM ('APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED');

-- CreateEnum
CREATE TYPE "credit_assessment_result" AS ENUM ('PASS', 'FAIL', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "repayment_schedule_status" AS ENUM ('ACTIVE', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "emi_status" AS ENUM ('PENDING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_type" AS ENUM ('FULL_PAYMENT', 'PARTIAL_PAYMENT', 'PENALTY_ONLY');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "payment_verification_status" AS ENUM ('PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "collection_component" AS ENUM ('PRINCIPAL', 'INTEREST', 'PENALTY', 'FEE');

-- CreateEnum
CREATE TYPE "disbursement_status" AS ENUM ('SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "penalty_calculation_type" AS ENUM ('FIXED_AMOUNT', 'DAILY_FIXED_AMOUNT', 'PERCENTAGE_OUTSTANDING_PER_DAY', 'PERCENTAGE_EMI_PER_DAY');

-- CreateEnum
CREATE TYPE "penalty_status" AS ENUM ('ASSESSED', 'PARTIALLY_PAID', 'PAID', 'ADJUSTED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "penalty_action_type" AS ENUM ('KEEP', 'ADJUST', 'WAIVE', 'CANCEL');

-- CreateEnum
CREATE TYPE "field_assignment_status" AS ENUM ('DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "assignment_customer_status" AS ENUM ('PENDING', 'VISITED', 'SKIPPED', 'COLLECTED');

-- CreateEnum
CREATE TYPE "field_visit_status" AS ENUM ('COMPLETED', 'CUSTOMER_UNAVAILABLE', 'REFUSED', 'PARTIAL_COLLECTION', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('QUEUED', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "recovery_case_status" AS ENUM ('OPEN', 'FIELD_ASSIGNED', 'FIELD_VISIT', 'BRANCH_REVIEW', 'LEGAL_NOTICE', 'SETTLEMENT_PENDING', 'SETTLED', 'LEGAL_ACTION', 'CLOSED');

-- CreateEnum
CREATE TYPE "recovery_action_type" AS ENUM ('REMINDER', 'PHONE_CALL', 'FIELD_ASSIGNMENT', 'FIELD_VISIT', 'BRANCH_REVIEW', 'LEGAL_NOTICE', 'SETTLEMENT', 'LEGAL_ACTION');

-- CreateEnum
CREATE TYPE "legal_notice_status" AS ENUM ('ISSUED', 'ACTIVE', 'EXPIRED', 'SETTLED', 'LEGAL_ACTION');

-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "closure_verification_status" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "noc_status" AS ENUM ('DRAFT', 'ISSUED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "receipt_type" AS ENUM ('COLLECTION', 'DISBURSEMENT', 'CLOSURE', 'PENALTY');

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "normal_balance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "journal_entry_status" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "journal_entry_type" AS ENUM ('DISBURSEMENT', 'COLLECTION', 'INTEREST_ACCRUAL', 'PENALTY_ASSESSMENT', 'PENALTY_ADJUSTMENT', 'PENALTY_WAIVER', 'PENALTY_CANCELLATION', 'FEE', 'EXPENSE', 'SETTLEMENT', 'WRITE_OFF', 'LOAN_CLOSURE', 'REVERSAL');

-- CreateEnum
CREATE TYPE "expense_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "day_closing_status" AS ENUM ('OPEN', 'PENDING_APPROVAL', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "cash_book_entry_type" AS ENUM ('RECEIPT', 'PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('SMS', 'PUSH', 'EMAIL', 'AUTO_CALL');

-- CreateEnum
CREATE TYPE "notification_event" AS ENUM ('LOAN_CLOSED', 'LOAN_APPROVED', 'LOAN_REJECTED', 'EMI_DUE_TOMORROW', 'EMI_DUE_TODAY', 'EMI_MISSED', 'PENALTY_ADDED', 'RECEIPT_GENERATED');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('QUEUED', 'PROCESSING', 'DELIVERED', 'PARTIALLY_DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "notification_template_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "notification_recipient_type" AS ENUM ('CUSTOMER', 'FIELD_AGENT', 'BRANCH_ADMIN', 'ORG_ADMIN');

-- CreateEnum
CREATE TYPE "report_type" AS ENUM ('BRANCH', 'DAILY_COLLECTION', 'WEEKLY', 'MONTHLY', 'LOAN', 'OUTSTANDING', 'EMPLOYEE_PERFORMANCE', 'CASH');

-- CreateEnum
CREATE TYPE "report_run_status" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "report_delivery_type" AS ENUM ('PDF', 'EXCEL', 'EMAIL');

-- CreateEnum
CREATE TYPE "report_delivery_status" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "org_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "legal_name" VARCHAR(250),
    "logo_file_ref" TEXT,
    "status" "organization_status" NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "org_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address_line1" VARCHAR(250) NOT NULL,
    "address_line2" VARCHAR(250),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "pincode" VARCHAR(10) NOT NULL,
    "phone" VARCHAR(30),
    "status" "branch_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("org_id","branch_id")
);

-- CreateTable
CREATE TABLE "users" (
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID,
    "employee_code" VARCHAR(50),
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320),
    "mobile" VARCHAR(20),
    "password_hash" TEXT,
    "status" "user_status" NOT NULL,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("org_id","user_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "org_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "status" "role_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("org_id","role_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "org_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "code" VARCHAR(150) NOT NULL,
    "module" VARCHAR(100) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("org_id","permission_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "org_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("org_id","role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("org_id","user_id","role_id")
);

-- CreateTable
CREATE TABLE "leads" (
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" VARCHAR(200),
    "mobile" VARCHAR(20),
    "source" VARCHAR(100),
    "status" "lead_status" NOT NULL,
    "referred_by" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("org_id","lead_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "org_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_code" VARCHAR(50) NOT NULL,
    "customer_type" "customer_type" NOT NULL,
    "lead_id" UUID,
    "full_name" VARCHAR(200) NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "mobile_verified_at" TIMESTAMPTZ(6),
    "date_of_birth" DATE,
    "gender" VARCHAR(30),
    "address_line1" VARCHAR(250) NOT NULL,
    "address_line2" VARCHAR(250),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "pincode" VARCHAR(10),
    "status" "customer_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("org_id","customer_id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "org_id" UUID NOT NULL,
    "customer_address_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "address_type" VARCHAR(30) NOT NULL,
    "address_line1" VARCHAR(250) NOT NULL,
    "address_line2" VARCHAR(250),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "pincode" VARCHAR(10),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("org_id","customer_address_id")
);

-- CreateTable
CREATE TABLE "customer_documents" (
    "org_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "file_ref" TEXT NOT NULL,
    "document_number" VARCHAR(100),
    "verification_status" "document_verification_status" NOT NULL,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("org_id","document_id")
);

-- CreateTable
CREATE TABLE "customer_kyc" (
    "org_id" UUID NOT NULL,
    "kyc_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "kyc_status" NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "revision_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_kyc_pkey" PRIMARY KEY ("org_id","kyc_id")
);

-- CreateTable
CREATE TABLE "guarantors" (
    "org_id" UUID NOT NULL,
    "guarantor_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "address" TEXT,
    "consent_status" "consent_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "guarantors_pkey" PRIMARY KEY ("org_id","guarantor_id")
);

-- CreateTable
CREATE TABLE "guarantor_documents" (
    "org_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "guarantor_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "file_ref" TEXT NOT NULL,
    "verification_status" "document_verification_status" NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "verified_by" UUID,

    CONSTRAINT "guarantor_documents_pkey" PRIMARY KEY ("org_id","document_id")
);

-- CreateTable
CREATE TABLE "loan_products" (
    "org_id" UUID NOT NULL,
    "loan_product_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "loan_type" "loan_type" NOT NULL,
    "status" "loan_product_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "loan_products_pkey" PRIMARY KEY ("org_id","loan_product_id")
);

-- CreateTable
CREATE TABLE "loan_schemes" (
    "org_id" UUID NOT NULL,
    "loan_scheme_id" UUID NOT NULL,
    "loan_product_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "interest_type" "interest_type" NOT NULL,
    "interest_rate_bps" BIGINT NOT NULL,
    "status" "loan_scheme_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "loan_schemes_pkey" PRIMARY KEY ("org_id","loan_scheme_id")
);

-- CreateTable
CREATE TABLE "loan_scheme_durations" (
    "org_id" UUID NOT NULL,
    "loan_scheme_duration_id" UUID NOT NULL,
    "loan_scheme_id" UUID NOT NULL,
    "frequency" "repayment_frequency" NOT NULL,
    "duration_count" INTEGER NOT NULL,
    "status" "record_status" NOT NULL,

    CONSTRAINT "loan_scheme_durations_pkey" PRIMARY KEY ("org_id","loan_scheme_duration_id")
);

-- CreateTable
CREATE TABLE "interest_configs" (
    "org_id" UUID NOT NULL,
    "interest_config_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "interest_type" "interest_type" NOT NULL,
    "rate_bps" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" "record_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_configs_pkey" PRIMARY KEY ("org_id","interest_config_id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "org_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "application_number" VARCHAR(50) NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "loan_product_id" UUID NOT NULL,
    "loan_scheme_id" UUID NOT NULL,
    "requested_amount_paise" BIGINT NOT NULL,
    "purpose" TEXT,
    "interest_type" "interest_type" NOT NULL,
    "interest_rate_bps" BIGINT NOT NULL,
    "repayment_frequency" "repayment_frequency" NOT NULL,
    "duration_count" INTEGER NOT NULL,
    "status" "application_status" NOT NULL,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "approved_by" UUID,
    "sanctioned_at" TIMESTAMPTZ(6),
    "agreement_signed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("org_id","application_id")
);

-- CreateTable
CREATE TABLE "loan_application_documents" (
    "org_id" UUID NOT NULL,
    "application_document_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "document_type" VARCHAR(50) NOT NULL,
    "file_ref" TEXT NOT NULL,
    "status" "document_status" NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_application_documents_pkey" PRIMARY KEY ("org_id","application_document_id")
);

-- CreateTable
CREATE TABLE "loan_application_reviews" (
    "org_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "review_type" "application_review_type" NOT NULL,
    "decision" "application_review_decision" NOT NULL,
    "comments" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_application_reviews_pkey" PRIMARY KEY ("org_id","review_id")
);

-- CreateTable
CREATE TABLE "credit_assessments" (
    "org_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "cibil_score" INTEGER,
    "income_verified" BOOLEAN,
    "assessment_result" "credit_assessment_result",
    "assessment_notes" TEXT,
    "assessed_by" UUID,
    "assessed_at" TIMESTAMPTZ(6),

    CONSTRAINT "credit_assessments_pkey" PRIMARY KEY ("org_id","assessment_id")
);

-- CreateTable
CREATE TABLE "loans" (
    "org_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "loan_number" VARCHAR(50) NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "loan_product_id" UUID NOT NULL,
    "loan_scheme_id" UUID NOT NULL,
    "principal_amount_paise" BIGINT NOT NULL,
    "interest_rate_bps" BIGINT NOT NULL,
    "interest_type" "interest_type" NOT NULL,
    "repayment_frequency" "repayment_frequency" NOT NULL,
    "duration_count" INTEGER NOT NULL,
    "status" "loan_status" NOT NULL,
    "sanction_date" DATE,
    "agreement_date" DATE,
    "disbursement_date" DATE,
    "closure_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("org_id","loan_id")
);

-- CreateTable
CREATE TABLE "loan_guarantors" (
    "org_id" UUID NOT NULL,
    "loan_guarantor_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "guarantor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_guarantors_pkey" PRIMARY KEY ("org_id","loan_guarantor_id")
);

-- CreateTable
CREATE TABLE "repayment_schedules" (
    "org_id" UUID NOT NULL,
    "repayment_schedule_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "repayment_schedule_status" NOT NULL,

    CONSTRAINT "repayment_schedules_pkey" PRIMARY KEY ("org_id","repayment_schedule_id")
);

-- CreateTable
CREATE TABLE "emis" (
    "org_id" UUID NOT NULL,
    "emi_id" UUID NOT NULL,
    "repayment_schedule_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "principal_due_paise" BIGINT NOT NULL,
    "interest_due_paise" BIGINT NOT NULL,
    "total_due_paise" BIGINT NOT NULL,
    "status" "emi_status" NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emis_pkey" PRIMARY KEY ("org_id","emi_id")
);

-- CreateTable
CREATE TABLE "disbursements" (
    "org_id" UUID NOT NULL,
    "disbursement_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "disbursed_at" TIMESTAMPTZ(6),
    "amount_paise" BIGINT NOT NULL,
    "payment_mode" "payment_mode" NOT NULL,
    "bank_account_reference" TEXT,
    "transaction_reference" VARCHAR(150),
    "status" "disbursement_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disbursements_pkey" PRIMARY KEY ("org_id","disbursement_id")
);

-- CreateTable
CREATE TABLE "collections" (
    "org_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "collector_user_id" UUID NOT NULL,
    "collection_date" DATE NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL,
    "payment_type" "payment_type" NOT NULL,
    "payment_mode" "payment_mode" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "transaction_reference" VARCHAR(150),
    "idempotency_key" VARCHAR(150) NOT NULL,
    "verification_status" "payment_verification_status" NOT NULL,
    "partial_payment_reason" TEXT,
    "verification_notes" TEXT,
    "offline_collected" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("org_id","collection_id")
);

-- CreateTable
CREATE TABLE "collection_allocations" (
    "org_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "emi_id" UUID,
    "component" "collection_component" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_allocations_pkey" PRIMARY KEY ("org_id","allocation_id")
);

-- CreateTable
CREATE TABLE "collection_verifications" (
    "org_id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "status" "payment_verification_status" NOT NULL,
    "verified_by" UUID,
    "verification_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_verifications_pkey" PRIMARY KEY ("org_id","verification_id")
);

-- CreateTable
CREATE TABLE "penalty_rules" (
    "org_id" UUID NOT NULL,
    "penalty_rule_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "calculation_type" "penalty_calculation_type" NOT NULL,
    "rate_bps" BIGINT,
    "fixed_amount_paise" BIGINT,
    "grace_days" INTEGER NOT NULL,
    "status" "record_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "penalty_rules_pkey" PRIMARY KEY ("org_id","penalty_rule_id")
);

-- CreateTable
CREATE TABLE "penalty_rule_overrides" (
    "org_id" UUID NOT NULL,
    "penalty_rule_override_id" UUID NOT NULL,
    "loan_scheme_id" UUID NOT NULL,
    "penalty_rule_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penalty_rule_overrides_pkey" PRIMARY KEY ("org_id","penalty_rule_override_id")
);

-- CreateTable
CREATE TABLE "loan_penalty_rule_overrides" (
    "org_id" UUID NOT NULL,
    "loan_penalty_rule_override_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "penalty_rule_id" UUID NOT NULL,
    "grace_days" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_penalty_rule_overrides_pkey" PRIMARY KEY ("org_id","loan_penalty_rule_override_id")
);

-- CreateTable
CREATE TABLE "penalties" (
    "org_id" UUID NOT NULL,
    "penalty_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "emi_id" UUID,
    "penalty_rule_id" UUID,
    "assessed_date" DATE NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "calculation_type" "penalty_calculation_type" NOT NULL,
    "calculation_snapshot" JSONB NOT NULL,
    "status" "penalty_status" NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("org_id","penalty_id")
);

-- CreateTable
CREATE TABLE "penalty_actions" (
    "org_id" UUID NOT NULL,
    "penalty_action_id" UUID NOT NULL,
    "penalty_id" UUID NOT NULL,
    "action" "penalty_action_type" NOT NULL,
    "amount_paise" BIGINT,
    "reason" TEXT NOT NULL,
    "performed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penalty_actions_pkey" PRIMARY KEY ("org_id","penalty_action_id")
);

-- CreateTable
CREATE TABLE "field_assignments" (
    "org_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "field_agent_id" UUID NOT NULL,
    "assignment_date" DATE NOT NULL,
    "route_name" VARCHAR(150),
    "schedule_start_at" TIMESTAMPTZ(6),
    "schedule_end_at" TIMESTAMPTZ(6),
    "status" "field_assignment_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_assignments_pkey" PRIMARY KEY ("org_id","assignment_id")
);

-- CreateTable
CREATE TABLE "field_assignment_customers" (
    "org_id" UUID NOT NULL,
    "assignment_customer_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "route_sequence" INTEGER,
    "status" "assignment_customer_status" NOT NULL,

    CONSTRAINT "field_assignment_customers_pkey" PRIMARY KEY ("org_id","assignment_customer_id")
);

-- CreateTable
CREATE TABLE "field_visits" (
    "org_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "assignment_id" UUID,
    "customer_id" UUID NOT NULL,
    "loan_id" UUID,
    "field_agent_id" UUID NOT NULL,
    "visited_at" TIMESTAMPTZ(6) NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "visit_status" "field_visit_status" NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_visits_pkey" PRIMARY KEY ("org_id","visit_id")
);

-- CreateTable
CREATE TABLE "offline_sync_items" (
    "org_id" UUID NOT NULL,
    "sync_item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_transaction_id" VARCHAR(150) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "sync_status" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "queued_at" TIMESTAMPTZ(6) NOT NULL,
    "synced_at" TIMESTAMPTZ(6),

    CONSTRAINT "offline_sync_items_pkey" PRIMARY KEY ("org_id","sync_item_id")
);

-- CreateTable
CREATE TABLE "recovery_cases" (
    "org_id" UUID NOT NULL,
    "recovery_case_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "emi_id" UUID,
    "branch_id" UUID NOT NULL,
    "status" "recovery_case_status" NOT NULL,
    "opened_date" DATE NOT NULL,
    "closed_date" DATE,
    "assigned_agent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recovery_cases_pkey" PRIMARY KEY ("org_id","recovery_case_id")
);

-- CreateTable
CREATE TABLE "recovery_actions" (
    "org_id" UUID NOT NULL,
    "recovery_action_id" UUID NOT NULL,
    "recovery_case_id" UUID NOT NULL,
    "action" "recovery_action_type" NOT NULL,
    "performed_by" UUID NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_actions_pkey" PRIMARY KEY ("org_id","recovery_action_id")
);

-- CreateTable
CREATE TABLE "legal_notices" (
    "org_id" UUID NOT NULL,
    "legal_notice_id" UUID NOT NULL,
    "recovery_case_id" UUID NOT NULL,
    "notice_date" DATE NOT NULL,
    "notice_period_days" INTEGER NOT NULL DEFAULT 30,
    "expiry_date" DATE NOT NULL,
    "status" "legal_notice_status" NOT NULL,
    "document_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_notices_pkey" PRIMARY KEY ("org_id","legal_notice_id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "org_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "recovery_case_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "settlement_amount_paise" BIGINT NOT NULL,
    "status" "settlement_status" NOT NULL,
    "agreed_date" DATE,
    "completed_date" DATE,
    "approved_by" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("org_id","settlement_id")
);

-- CreateTable
CREATE TABLE "loan_closures" (
    "org_id" UUID NOT NULL,
    "loan_closure_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "closure_date" DATE NOT NULL,
    "closure_amount_paise" BIGINT NOT NULL,
    "verification_status" "closure_verification_status" NOT NULL,
    "final_collection_id" UUID,
    "closed_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_closures_pkey" PRIMARY KEY ("org_id","loan_closure_id")
);

-- CreateTable
CREATE TABLE "nocs" (
    "org_id" UUID NOT NULL,
    "noc_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "noc_number" VARCHAR(100) NOT NULL,
    "issued_date" DATE NOT NULL,
    "file_ref" TEXT,
    "status" "noc_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nocs_pkey" PRIMARY KEY ("org_id","noc_id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "org_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "receipt_number" VARCHAR(100) NOT NULL,
    "loan_id" UUID NOT NULL,
    "collection_id" UUID,
    "loan_closure_id" UUID,
    "receipt_type" "receipt_type" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "file_ref" TEXT,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("org_id","receipt_id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "account_code" VARCHAR(50) NOT NULL,
    "account_name" VARCHAR(200) NOT NULL,
    "account_type" "account_type" NOT NULL,
    "normal_balance" "normal_balance" NOT NULL,
    "parent_account_id" UUID,
    "status" "account_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("org_id","account_id")
);

-- CreateTable
CREATE TABLE "account_dimensions" (
    "org_id" UUID NOT NULL,
    "dimension_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "branch_id" UUID,
    "loan_id" UUID,
    "customer_id" UUID,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_dimensions_pkey" PRIMARY KEY ("org_id","dimension_id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "org_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "entry_number" VARCHAR(100) NOT NULL,
    "entry_date" DATE NOT NULL,
    "posted_at" TIMESTAMPTZ(6) NOT NULL,
    "entry_type" "journal_entry_type" NOT NULL,
    "status" "journal_entry_status" NOT NULL,
    "source_type" VARCHAR(50),
    "source_id" UUID,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("org_id","journal_entry_id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "org_id" UUID NOT NULL,
    "journal_line_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "dimension_id" UUID,
    "debit_paise" BIGINT NOT NULL DEFAULT 0,
    "credit_paise" BIGINT NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("org_id","journal_line_id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "org_id" UUID NOT NULL,
    "expense_category_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "record_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("org_id","expense_category_id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "org_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "expense_date" DATE NOT NULL,
    "payment_mode" "payment_mode" NOT NULL,
    "description" TEXT,
    "status" "expense_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("org_id","expense_id")
);

-- CreateTable
CREATE TABLE "day_closings" (
    "org_id" UUID NOT NULL,
    "day_closing_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "closing_date" DATE NOT NULL,
    "status" "day_closing_status" NOT NULL,
    "closed_by" UUID,
    "closed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_closings_pkey" PRIMARY KEY ("org_id","day_closing_id")
);

-- CreateTable
CREATE TABLE "cash_book_entries" (
    "org_id" UUID NOT NULL,
    "cash_book_entry_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "entry_type" "cash_book_entry_type" NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "source_type" VARCHAR(50),
    "source_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_book_entries_pkey" PRIMARY KEY ("org_id","cash_book_entry_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "org_id" UUID NOT NULL,
    "audit_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(150) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "request_id" UUID,
    "ip_address" INET,
    "user_agent" TEXT,
    "old_data" JSONB,
    "new_data" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("org_id","audit_id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "org_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "event_type" "notification_event" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "subject" VARCHAR(250),
    "body" TEXT NOT NULL,
    "status" "notification_template_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("org_id","template_id")
);

-- CreateTable
CREATE TABLE "notification_triggers" (
    "org_id" UUID NOT NULL,
    "trigger_id" UUID NOT NULL,
    "event_type" "notification_event" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "recipient_type" "notification_recipient_type" NOT NULL,
    "template_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_triggers_pkey" PRIMARY KEY ("org_id","trigger_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "org_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "event_type" "notification_event" NOT NULL,
    "source_type" VARCHAR(50),
    "source_id" UUID,
    "recipient_user_id" UUID,
    "recipient_customer_id" UUID,
    "template_id" UUID,
    "status" "notification_status" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("org_id","notification_id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "org_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "notification_delivery_status" NOT NULL,
    "provider_message_id" VARCHAR(200),
    "failure_reason" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("org_id","delivery_id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "org_id" UUID NOT NULL,
    "report_definition_id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "report_type" "report_type" NOT NULL,
    "status" "record_status" NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("org_id","report_definition_id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "org_id" UUID NOT NULL,
    "report_run_id" UUID NOT NULL,
    "report_definition_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "filters" JSONB NOT NULL,
    "status" "report_run_status" NOT NULL,
    "file_ref" TEXT,
    "failure_reason" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("org_id","report_run_id")
);

-- CreateTable
CREATE TABLE "report_deliveries" (
    "org_id" UUID NOT NULL,
    "report_delivery_id" UUID NOT NULL,
    "report_run_id" UUID NOT NULL,
    "delivery_type" "report_delivery_type" NOT NULL,
    "recipient" TEXT,
    "status" "report_delivery_status" NOT NULL,
    "failure_reason" TEXT,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_deliveries_pkey" PRIMARY KEY ("org_id","report_delivery_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_org_id_code_key" ON "branches"("org_id", "code");

-- CreateIndex
CREATE INDEX "users_org_id_branch_id_idx" ON "users"("org_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_org_id_email_key" ON "users"("org_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_org_id_mobile_key" ON "users"("org_id", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "users_org_id_employee_code_key" ON "users"("org_id", "employee_code");

-- CreateIndex
CREATE UNIQUE INDEX "roles_org_id_code_key" ON "roles"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_org_id_code_key" ON "permissions"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_org_id_module_action_key" ON "permissions"("org_id", "module", "action");

-- CreateIndex
CREATE INDEX "leads_org_id_branch_id_idx" ON "leads"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "leads_org_id_status_idx" ON "leads"("org_id", "status");

-- CreateIndex
CREATE INDEX "customers_org_id_mobile_idx" ON "customers"("org_id", "mobile");

-- CreateIndex
CREATE INDEX "customers_org_id_full_name_idx" ON "customers"("org_id", "full_name");

-- CreateIndex
CREATE INDEX "customers_org_id_branch_id_idx" ON "customers"("org_id", "branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_org_id_customer_code_key" ON "customers"("org_id", "customer_code");

-- CreateIndex
CREATE INDEX "customer_addresses_org_id_customer_id_idx" ON "customer_addresses"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_documents_org_id_customer_id_idx" ON "customer_documents"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_kyc_org_id_customer_id_idx" ON "customer_kyc"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "guarantors_org_id_customer_id_idx" ON "guarantors"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "guarantor_documents_org_id_guarantor_id_idx" ON "guarantor_documents"("org_id", "guarantor_id");

-- CreateIndex
CREATE UNIQUE INDEX "loan_products_org_id_code_key" ON "loan_products"("org_id", "code");

-- CreateIndex
CREATE INDEX "loan_schemes_org_id_loan_product_id_idx" ON "loan_schemes"("org_id", "loan_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "loan_schemes_org_id_code_key" ON "loan_schemes"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "loan_scheme_durations_org_id_loan_scheme_id_frequency_durat_key" ON "loan_scheme_durations"("org_id", "loan_scheme_id", "frequency", "duration_count");

-- CreateIndex
CREATE INDEX "interest_configs_org_id_effective_from_idx" ON "interest_configs"("org_id", "effective_from");

-- CreateIndex
CREATE INDEX "loan_applications_org_id_customer_id_idx" ON "loan_applications"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "loan_applications_org_id_branch_id_status_idx" ON "loan_applications"("org_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "loan_applications_org_id_status_idx" ON "loan_applications"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_applications_org_id_application_number_key" ON "loan_applications"("org_id", "application_number");

-- CreateIndex
CREATE INDEX "loan_application_documents_org_id_application_id_idx" ON "loan_application_documents"("org_id", "application_id");

-- CreateIndex
CREATE INDEX "loan_application_reviews_org_id_application_id_idx" ON "loan_application_reviews"("org_id", "application_id");

-- CreateIndex
CREATE INDEX "credit_assessments_org_id_application_id_idx" ON "credit_assessments"("org_id", "application_id");

-- CreateIndex
CREATE INDEX "loans_org_id_customer_id_idx" ON "loans"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "loans_org_id_branch_id_status_idx" ON "loans"("org_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "loans_org_id_status_idx" ON "loans"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loans_org_id_loan_number_key" ON "loans"("org_id", "loan_number");

-- CreateIndex
CREATE UNIQUE INDEX "loan_guarantors_org_id_loan_id_guarantor_id_key" ON "loan_guarantors"("org_id", "loan_id", "guarantor_id");

-- CreateIndex
CREATE UNIQUE INDEX "repayment_schedules_org_id_loan_id_version_key" ON "repayment_schedules"("org_id", "loan_id", "version");

-- CreateIndex
CREATE INDEX "emis_org_id_due_date_idx" ON "emis"("org_id", "due_date");

-- CreateIndex
CREATE INDEX "emis_org_id_loan_id_status_idx" ON "emis"("org_id", "loan_id", "status");

-- CreateIndex
CREATE INDEX "emis_org_id_status_due_date_idx" ON "emis"("org_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "emis_org_id_repayment_schedule_id_installment_number_key" ON "emis"("org_id", "repayment_schedule_id", "installment_number");

-- CreateIndex
CREATE INDEX "disbursements_org_id_loan_id_idx" ON "disbursements"("org_id", "loan_id");

-- CreateIndex
CREATE INDEX "disbursements_org_id_branch_id_status_idx" ON "disbursements"("org_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "collections_org_id_branch_id_collection_date_idx" ON "collections"("org_id", "branch_id", "collection_date");

-- CreateIndex
CREATE INDEX "collections_org_id_collector_user_id_collection_date_idx" ON "collections"("org_id", "collector_user_id", "collection_date");

-- CreateIndex
CREATE INDEX "collections_org_id_loan_id_idx" ON "collections"("org_id", "loan_id");

-- CreateIndex
CREATE UNIQUE INDEX "collections_org_id_idempotency_key_key" ON "collections"("org_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "collection_allocations_org_id_collection_id_idx" ON "collection_allocations"("org_id", "collection_id");

-- CreateIndex
CREATE INDEX "collection_allocations_org_id_emi_id_idx" ON "collection_allocations"("org_id", "emi_id");

-- CreateIndex
CREATE INDEX "collection_verifications_org_id_collection_id_idx" ON "collection_verifications"("org_id", "collection_id");

-- CreateIndex
CREATE INDEX "penalty_rule_overrides_org_id_loan_scheme_id_idx" ON "penalty_rule_overrides"("org_id", "loan_scheme_id");

-- CreateIndex
CREATE INDEX "loan_penalty_rule_overrides_org_id_loan_id_idx" ON "loan_penalty_rule_overrides"("org_id", "loan_id");

-- CreateIndex
CREATE INDEX "penalties_org_id_loan_id_status_idx" ON "penalties"("org_id", "loan_id", "status");

-- CreateIndex
CREATE INDEX "penalties_org_id_assessed_date_idx" ON "penalties"("org_id", "assessed_date");

-- CreateIndex
CREATE INDEX "penalty_actions_org_id_penalty_id_idx" ON "penalty_actions"("org_id", "penalty_id");

-- CreateIndex
CREATE INDEX "field_assignments_org_id_field_agent_id_assignment_date_idx" ON "field_assignments"("org_id", "field_agent_id", "assignment_date");

-- CreateIndex
CREATE INDEX "field_assignments_org_id_branch_id_assignment_date_idx" ON "field_assignments"("org_id", "branch_id", "assignment_date");

-- CreateIndex
CREATE UNIQUE INDEX "field_assignment_customers_org_id_assignment_id_customer_id_key" ON "field_assignment_customers"("org_id", "assignment_id", "customer_id");

-- CreateIndex
CREATE INDEX "field_visits_org_id_customer_id_idx" ON "field_visits"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "field_visits_org_id_field_agent_id_visited_at_idx" ON "field_visits"("org_id", "field_agent_id", "visited_at");

-- CreateIndex
CREATE INDEX "offline_sync_items_org_id_status_idx" ON "offline_sync_items"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "offline_sync_items_org_id_client_transaction_id_key" ON "offline_sync_items"("org_id", "client_transaction_id");

-- CreateIndex
CREATE INDEX "recovery_cases_org_id_status_idx" ON "recovery_cases"("org_id", "status");

-- CreateIndex
CREATE INDEX "recovery_cases_org_id_branch_id_status_idx" ON "recovery_cases"("org_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "recovery_cases_org_id_loan_id_idx" ON "recovery_cases"("org_id", "loan_id");

-- CreateIndex
CREATE INDEX "recovery_actions_org_id_recovery_case_id_idx" ON "recovery_actions"("org_id", "recovery_case_id");

-- CreateIndex
CREATE INDEX "legal_notices_org_id_recovery_case_id_idx" ON "legal_notices"("org_id", "recovery_case_id");

-- CreateIndex
CREATE INDEX "settlements_org_id_recovery_case_id_idx" ON "settlements"("org_id", "recovery_case_id");

-- CreateIndex
CREATE INDEX "settlements_org_id_loan_id_idx" ON "settlements"("org_id", "loan_id");

-- CreateIndex
CREATE INDEX "loan_closures_org_id_loan_id_idx" ON "loan_closures"("org_id", "loan_id");

-- CreateIndex
CREATE INDEX "nocs_org_id_loan_id_idx" ON "nocs"("org_id", "loan_id");

-- CreateIndex
CREATE UNIQUE INDEX "nocs_org_id_noc_number_key" ON "nocs"("org_id", "noc_number");

-- CreateIndex
CREATE INDEX "receipts_org_id_loan_id_idx" ON "receipts"("org_id", "loan_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_org_id_receipt_number_key" ON "receipts"("org_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_org_id_account_code_key" ON "accounts"("org_id", "account_code");

-- CreateIndex
CREATE INDEX "account_dimensions_org_id_loan_id_idx" ON "account_dimensions"("org_id", "loan_id");

-- CreateIndex
CREATE INDEX "account_dimensions_org_id_customer_id_idx" ON "account_dimensions"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "account_dimensions_org_id_branch_id_idx" ON "account_dimensions"("org_id", "branch_id");

-- CreateIndex
CREATE INDEX "account_dimensions_org_id_account_id_idx" ON "account_dimensions"("org_id", "account_id");

-- CreateIndex
CREATE INDEX "journal_entries_org_id_entry_date_idx" ON "journal_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "journal_entries_org_id_source_type_source_id_idx" ON "journal_entries"("org_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_org_id_entry_number_key" ON "journal_entries"("org_id", "entry_number");

-- CreateIndex
CREATE INDEX "journal_lines_org_id_journal_entry_id_idx" ON "journal_lines"("org_id", "journal_entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_org_id_account_id_idx" ON "journal_lines"("org_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_org_id_journal_entry_id_line_number_key" ON "journal_lines"("org_id", "journal_entry_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_org_id_code_key" ON "expense_categories"("org_id", "code");

-- CreateIndex
CREATE INDEX "expenses_org_id_branch_id_expense_date_idx" ON "expenses"("org_id", "branch_id", "expense_date");

-- CreateIndex
CREATE UNIQUE INDEX "day_closings_org_id_branch_id_closing_date_key" ON "day_closings"("org_id", "branch_id", "closing_date");

-- CreateIndex
CREATE INDEX "cash_book_entries_org_id_branch_id_entry_date_idx" ON "cash_book_entries"("org_id", "branch_id", "entry_date");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_occurred_at_idx" ON "audit_logs"("org_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_entity_type_entity_id_idx" ON "audit_logs"("org_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_actor_user_id_idx" ON "audit_logs"("org_id", "actor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_org_id_code_channel_key" ON "notification_templates"("org_id", "code", "channel");

-- CreateIndex
CREATE INDEX "notification_triggers_org_id_event_type_channel_idx" ON "notification_triggers"("org_id", "event_type", "channel");

-- CreateIndex
CREATE INDEX "notifications_org_id_status_idx" ON "notifications"("org_id", "status");

-- CreateIndex
CREATE INDEX "notifications_org_id_event_type_idx" ON "notifications"("org_id", "event_type");

-- CreateIndex
CREATE INDEX "notification_deliveries_org_id_notification_id_idx" ON "notification_deliveries"("org_id", "notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_org_id_notification_id_channel_atte_key" ON "notification_deliveries"("org_id", "notification_id", "channel", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "report_definitions_org_id_code_key" ON "report_definitions"("org_id", "code");

-- CreateIndex
CREATE INDEX "report_runs_org_id_report_definition_id_idx" ON "report_runs"("org_id", "report_definition_id");

-- CreateIndex
CREATE INDEX "report_runs_org_id_status_idx" ON "report_runs"("org_id", "status");

-- CreateIndex
CREATE INDEX "report_deliveries_org_id_report_run_id_idx" ON "report_deliveries"("org_id", "report_run_id");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_org_id_role_id_fkey" FOREIGN KEY ("org_id", "role_id") REFERENCES "roles"("org_id", "role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_org_id_permission_id_fkey" FOREIGN KEY ("org_id", "permission_id") REFERENCES "permissions"("org_id", "permission_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "users"("org_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_org_id_role_id_fkey" FOREIGN KEY ("org_id", "role_id") REFERENCES "roles"("org_id", "role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_lead_id_fkey" FOREIGN KEY ("org_id", "lead_id") REFERENCES "leads"("org_id", "lead_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_documents" ADD CONSTRAINT "customer_documents_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_kyc" ADD CONSTRAINT "customer_kyc_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_kyc" ADD CONSTRAINT "customer_kyc_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantors" ADD CONSTRAINT "guarantors_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantor_documents" ADD CONSTRAINT "guarantor_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guarantor_documents" ADD CONSTRAINT "guarantor_documents_org_id_guarantor_id_fkey" FOREIGN KEY ("org_id", "guarantor_id") REFERENCES "guarantors"("org_id", "guarantor_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_products" ADD CONSTRAINT "loan_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_schemes" ADD CONSTRAINT "loan_schemes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_schemes" ADD CONSTRAINT "loan_schemes_org_id_loan_product_id_fkey" FOREIGN KEY ("org_id", "loan_product_id") REFERENCES "loan_products"("org_id", "loan_product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_scheme_durations" ADD CONSTRAINT "loan_scheme_durations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_scheme_durations" ADD CONSTRAINT "loan_scheme_durations_org_id_loan_scheme_id_fkey" FOREIGN KEY ("org_id", "loan_scheme_id") REFERENCES "loan_schemes"("org_id", "loan_scheme_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_configs" ADD CONSTRAINT "interest_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_org_id_loan_product_id_fkey" FOREIGN KEY ("org_id", "loan_product_id") REFERENCES "loan_products"("org_id", "loan_product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_org_id_loan_scheme_id_fkey" FOREIGN KEY ("org_id", "loan_scheme_id") REFERENCES "loan_schemes"("org_id", "loan_scheme_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_application_documents" ADD CONSTRAINT "loan_application_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_application_documents" ADD CONSTRAINT "loan_application_documents_org_id_application_id_fkey" FOREIGN KEY ("org_id", "application_id") REFERENCES "loan_applications"("org_id", "application_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_application_reviews" ADD CONSTRAINT "loan_application_reviews_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_application_reviews" ADD CONSTRAINT "loan_application_reviews_org_id_application_id_fkey" FOREIGN KEY ("org_id", "application_id") REFERENCES "loan_applications"("org_id", "application_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_assessments" ADD CONSTRAINT "credit_assessments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_assessments" ADD CONSTRAINT "credit_assessments_org_id_application_id_fkey" FOREIGN KEY ("org_id", "application_id") REFERENCES "loan_applications"("org_id", "application_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_org_id_application_id_fkey" FOREIGN KEY ("org_id", "application_id") REFERENCES "loan_applications"("org_id", "application_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_org_id_loan_product_id_fkey" FOREIGN KEY ("org_id", "loan_product_id") REFERENCES "loan_products"("org_id", "loan_product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_org_id_loan_scheme_id_fkey" FOREIGN KEY ("org_id", "loan_scheme_id") REFERENCES "loan_schemes"("org_id", "loan_scheme_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_guarantors" ADD CONSTRAINT "loan_guarantors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_guarantors" ADD CONSTRAINT "loan_guarantors_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_guarantors" ADD CONSTRAINT "loan_guarantors_org_id_guarantor_id_fkey" FOREIGN KEY ("org_id", "guarantor_id") REFERENCES "guarantors"("org_id", "guarantor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_schedules" ADD CONSTRAINT "repayment_schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repayment_schedules" ADD CONSTRAINT "repayment_schedules_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emis" ADD CONSTRAINT "emis_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emis" ADD CONSTRAINT "emis_org_id_repayment_schedule_id_fkey" FOREIGN KEY ("org_id", "repayment_schedule_id") REFERENCES "repayment_schedules"("org_id", "repayment_schedule_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emis" ADD CONSTRAINT "emis_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_collector_user_id_fkey" FOREIGN KEY ("org_id", "collector_user_id") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_allocations" ADD CONSTRAINT "collection_allocations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_allocations" ADD CONSTRAINT "collection_allocations_org_id_collection_id_fkey" FOREIGN KEY ("org_id", "collection_id") REFERENCES "collections"("org_id", "collection_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_allocations" ADD CONSTRAINT "collection_allocations_org_id_emi_id_fkey" FOREIGN KEY ("org_id", "emi_id") REFERENCES "emis"("org_id", "emi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_verifications" ADD CONSTRAINT "collection_verifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_verifications" ADD CONSTRAINT "collection_verifications_org_id_collection_id_fkey" FOREIGN KEY ("org_id", "collection_id") REFERENCES "collections"("org_id", "collection_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_rules" ADD CONSTRAINT "penalty_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_rule_overrides" ADD CONSTRAINT "penalty_rule_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_rule_overrides" ADD CONSTRAINT "penalty_rule_overrides_org_id_loan_scheme_id_fkey" FOREIGN KEY ("org_id", "loan_scheme_id") REFERENCES "loan_schemes"("org_id", "loan_scheme_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_rule_overrides" ADD CONSTRAINT "penalty_rule_overrides_org_id_penalty_rule_id_fkey" FOREIGN KEY ("org_id", "penalty_rule_id") REFERENCES "penalty_rules"("org_id", "penalty_rule_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_penalty_rule_overrides" ADD CONSTRAINT "loan_penalty_rule_overrides_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_penalty_rule_overrides" ADD CONSTRAINT "loan_penalty_rule_overrides_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_penalty_rule_overrides" ADD CONSTRAINT "loan_penalty_rule_overrides_org_id_penalty_rule_id_fkey" FOREIGN KEY ("org_id", "penalty_rule_id") REFERENCES "penalty_rules"("org_id", "penalty_rule_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_org_id_emi_id_fkey" FOREIGN KEY ("org_id", "emi_id") REFERENCES "emis"("org_id", "emi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_org_id_penalty_rule_id_fkey" FOREIGN KEY ("org_id", "penalty_rule_id") REFERENCES "penalty_rules"("org_id", "penalty_rule_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_actions" ADD CONSTRAINT "penalty_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_actions" ADD CONSTRAINT "penalty_actions_org_id_penalty_id_fkey" FOREIGN KEY ("org_id", "penalty_id") REFERENCES "penalties"("org_id", "penalty_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_assignments" ADD CONSTRAINT "field_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_assignments" ADD CONSTRAINT "field_assignments_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_assignments" ADD CONSTRAINT "field_assignments_org_id_field_agent_id_fkey" FOREIGN KEY ("org_id", "field_agent_id") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_assignment_customers" ADD CONSTRAINT "field_assignment_customers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_assignment_customers" ADD CONSTRAINT "field_assignment_customers_org_id_assignment_id_fkey" FOREIGN KEY ("org_id", "assignment_id") REFERENCES "field_assignments"("org_id", "assignment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_assignment_customers" ADD CONSTRAINT "field_assignment_customers_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_org_id_assignment_id_fkey" FOREIGN KEY ("org_id", "assignment_id") REFERENCES "field_assignments"("org_id", "assignment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_visits" ADD CONSTRAINT "field_visits_org_id_field_agent_id_fkey" FOREIGN KEY ("org_id", "field_agent_id") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_items" ADD CONSTRAINT "offline_sync_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_sync_items" ADD CONSTRAINT "offline_sync_items_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_org_id_emi_id_fkey" FOREIGN KEY ("org_id", "emi_id") REFERENCES "emis"("org_id", "emi_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_org_id_assigned_agent_id_fkey" FOREIGN KEY ("org_id", "assigned_agent_id") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recovery_actions" ADD CONSTRAINT "recovery_actions_org_id_recovery_case_id_fkey" FOREIGN KEY ("org_id", "recovery_case_id") REFERENCES "recovery_cases"("org_id", "recovery_case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_notices" ADD CONSTRAINT "legal_notices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_notices" ADD CONSTRAINT "legal_notices_org_id_recovery_case_id_fkey" FOREIGN KEY ("org_id", "recovery_case_id") REFERENCES "recovery_cases"("org_id", "recovery_case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_org_id_recovery_case_id_fkey" FOREIGN KEY ("org_id", "recovery_case_id") REFERENCES "recovery_cases"("org_id", "recovery_case_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_closures" ADD CONSTRAINT "loan_closures_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_closures" ADD CONSTRAINT "loan_closures_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_closures" ADD CONSTRAINT "loan_closures_org_id_final_collection_id_fkey" FOREIGN KEY ("org_id", "final_collection_id") REFERENCES "collections"("org_id", "collection_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nocs" ADD CONSTRAINT "nocs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nocs" ADD CONSTRAINT "nocs_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_org_id_loan_id_fkey" FOREIGN KEY ("org_id", "loan_id") REFERENCES "loans"("org_id", "loan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_org_id_collection_id_fkey" FOREIGN KEY ("org_id", "collection_id") REFERENCES "collections"("org_id", "collection_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_org_id_loan_closure_id_fkey" FOREIGN KEY ("org_id", "loan_closure_id") REFERENCES "loan_closures"("org_id", "loan_closure_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_parent_account_id_fkey" FOREIGN KEY ("org_id", "parent_account_id") REFERENCES "accounts"("org_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_dimensions" ADD CONSTRAINT "account_dimensions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_dimensions" ADD CONSTRAINT "account_dimensions_org_id_account_id_fkey" FOREIGN KEY ("org_id", "account_id") REFERENCES "accounts"("org_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_journal_entry_id_fkey" FOREIGN KEY ("org_id", "journal_entry_id") REFERENCES "journal_entries"("org_id", "journal_entry_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_account_id_fkey" FOREIGN KEY ("org_id", "account_id") REFERENCES "accounts"("org_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_dimension_id_fkey" FOREIGN KEY ("org_id", "dimension_id") REFERENCES "account_dimensions"("org_id", "dimension_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_category_id_fkey" FOREIGN KEY ("org_id", "category_id") REFERENCES "expense_categories"("org_id", "expense_category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closings" ADD CONSTRAINT "day_closings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_closings" ADD CONSTRAINT "day_closings_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_book_entries" ADD CONSTRAINT "cash_book_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_book_entries" ADD CONSTRAINT "cash_book_entries_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_actor_user_id_fkey" FOREIGN KEY ("org_id", "actor_user_id") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_triggers" ADD CONSTRAINT "notification_triggers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_triggers" ADD CONSTRAINT "notification_triggers_org_id_template_id_fkey" FOREIGN KEY ("org_id", "template_id") REFERENCES "notification_templates"("org_id", "template_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_recipient_user_id_fkey" FOREIGN KEY ("org_id", "recipient_user_id") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_recipient_customer_id_fkey" FOREIGN KEY ("org_id", "recipient_customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_template_id_fkey" FOREIGN KEY ("org_id", "template_id") REFERENCES "notification_templates"("org_id", "template_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_org_id_notification_id_fkey" FOREIGN KEY ("org_id", "notification_id") REFERENCES "notifications"("org_id", "notification_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_org_id_report_definition_id_fkey" FOREIGN KEY ("org_id", "report_definition_id") REFERENCES "report_definitions"("org_id", "report_definition_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_org_id_requested_by_fkey" FOREIGN KEY ("org_id", "requested_by") REFERENCES "users"("org_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_org_id_report_run_id_fkey" FOREIGN KEY ("org_id", "report_run_id") REFERENCES "report_runs"("org_id", "report_run_id") ON DELETE CASCADE ON UPDATE CASCADE;
