-- CreateTable
CREATE TABLE "master_data_values" (
    "org_id" UUID NOT NULL,
    "value_id" UUID NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "master_data_values_pkey" PRIMARY KEY ("org_id","value_id")
);

-- CreateIndex
CREATE INDEX "master_data_values_org_id_category_status_display_order_idx" ON "master_data_values"("org_id", "category", "status", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "master_data_values_org_id_category_code_key" ON "master_data_values"("org_id", "category", "code");

-- AddForeignKey
ALTER TABLE "master_data_values" ADD CONSTRAINT "master_data_values_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;
