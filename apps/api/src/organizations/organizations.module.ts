import { Module } from '@nestjs/common';

import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

/**
 * Module 02 — Organizations & Branches.
 *
 * Imports nothing: PrismaModule, AuditModule and ConfigModule are all `@Global`.
 *
 * `BranchService` is exported because `assertBranchOperational` is the seam
 * every future branch-scoped module needs — customers, loans and collections
 * must each refuse to write to an inactive branch (Rules 47, 50), and that rule
 * belongs in one place rather than copied into each of them.
 */
@Module({
  controllers: [OrganizationController, BranchController],
  providers: [OrganizationService, BranchService],
  exports: [OrganizationService, BranchService],
})
export class OrganizationsModule {}
