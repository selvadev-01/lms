import { Module } from '@nestjs/common';

import { LoansModule } from '../loans/loans.module';
import {
  RecoveryActionController,
  RecoveryCaseController,
  SettlementController,
} from './cases/recovery-case.controller';
import { RecoveryActionService } from './cases/recovery-action.service';
import { RecoveryCaseService } from './cases/recovery-case.service';
import { OverdueController } from './overdue/overdue.controller';
import { OverdueService } from './overdue/overdue.service';
import { PenaltyService } from './penalty/penalty.service';
import { SettlementService } from './settlements/settlement.service';

/**
 * Module 13 — Overdue & Recovery.
 *
 * # Why a top-level module rather than part of `LoansModule`
 *
 * The `FieldModule` precedent. Recovery *reaches* loans — through
 * `LoanService.findInScope` and the repayment schedule — but a recovery case is
 * not part of a loan's own lifecycle: it is a workflow about a loan, with its
 * own actors, its own states and its own permissions. Folding it into
 * `LoansModule` would grow that module a fourth responsibility and make the
 * dependency point the wrong way, since nothing in lending needs to know
 * recovery exists.
 *
 * `imports: [LoansModule]` gives it `LoanService` and `LedgerService`, both
 * already exported there — `LoansModule`'s own comment names overdue and
 * recovery as the reason `findInScope` and `deriveEmiStatus` are exported at
 * all.
 *
 * # Controller order
 *
 * `RecoveryCaseController` mounts literal segments (`penalties/assess`) beside
 * `:recoveryCaseId` on the same base path. Nest matches in declaration order
 * within a controller, and the literals are declared first there — see the
 * class. Across controllers the base paths do not overlap, so their relative
 * order here is free.
 */
@Module({
  imports: [LoansModule],
  controllers: [
    OverdueController,
    RecoveryCaseController,
    RecoveryActionController,
    SettlementController,
  ],
  providers: [
    OverdueService,
    PenaltyService,
    RecoveryCaseService,
    RecoveryActionService,
    SettlementService,
  ],
  exports: [OverdueService],
})
export class RecoveryModule {}
