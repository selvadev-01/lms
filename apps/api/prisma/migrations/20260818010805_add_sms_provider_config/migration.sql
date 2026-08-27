-- CreateEnum
CREATE TYPE "sms_provider_kind" AS ENUM ('CONSOLE', 'TWILIO');

-- CreateTable
CREATE TABLE "sms_provider_configs" (
    "org_id" UUID NOT NULL,
    "config_id" UUID NOT NULL,
    "provider" "sms_provider_kind" NOT NULL,
    "messaging_service_sid" VARCHAR(64),
    "from_number" VARCHAR(20),
    "default_country_code" VARCHAR(5) NOT NULL DEFAULT '+91',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sms_provider_configs_pkey" PRIMARY KEY ("org_id","config_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_provider_configs_org_id_key" ON "sms_provider_configs"("org_id");

-- AddForeignKey
ALTER TABLE "sms_provider_configs" ADD CONSTRAINT "sms_provider_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;
