import { Module } from '@nestjs/common';

import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { OrganizationProvisioningService } from './provisioning/organization-provisioning.service';

/**
 * Module 02 — Organizations & Branches.
 *
 * Imports nothing: PrismaModule, AuditModule and ConfigModule are all `@Global`.
 *
 * `BranchService` is exported because `assertBranchOperational` is the seam
 * every future branch-scoped module needs — customers, loans and collections
 * must each refuse to write to an inactive branch (Rules 47, 50), and that rule
 * belongs in one place rather than copied into each of them.
 *
 * `OrganizationProvisioningService` is exported for the signup path in
 * `AuthModule`. It lives here rather than there because standing up an
 * organization is this module's subject, not authentication's.
 */
@Module({
  controllers: [OrganizationController, BranchController],
  providers: [
    OrganizationService,
    BranchService,
    OrganizationProvisioningService,
  ],
  exports: [
    OrganizationService,
    BranchService,
    OrganizationProvisioningService,
  ],
})
export class OrganizationsModule {}
