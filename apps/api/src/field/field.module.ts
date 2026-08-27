import { Module } from '@nestjs/common';

import { LoansModule } from '../loans/loans.module';
import { CashCustodyService } from './cash/cash-custody.service';
import { CashHandoverController } from './cash/cash-handover.controller';
import { CashHandoverService } from './cash/cash-handover.service';
import { CashReconciliationController } from './cash/cash-reconciliation.controller';
import { CashReconciliationService } from './cash/cash-reconciliation.service';
import { FieldCollectionController } from './collection/field-collection.controller';
import { FieldCollectionService } from './collection/field-collection.service';
import { GpsCheckInController } from './gps-check-in.controller';
import { GpsCheckInService } from './gps-check-in.service';
import { OfflineSyncController } from './sync/offline-sync.controller';
import { OfflineSyncService } from './sync/offline-sync.service';

/**
 * Field operations.
 *
 * PrismaModule, AuditModule and ConfigModule are all `@Global`, so nothing was
 * imported here before Module 12. `LoansModule` is, and deliberately:
 * `FieldCollectionService` delegates every posting to `CollectionService`, and
 * `CashHandoverService` posts through `LedgerService`. Importing them is what
 * keeps this module from growing its own copy of either — a second writer of
 * `collections` or of `journal_lines` is precisely what Modules 11 and 09
 * document against.
 *
 * `GpsCheckInService` stays exported for the same reason it always was: later
 * field stories need to ask whether a caller holds a current verified check-in.
 */
@Module({
  imports: [LoansModule],
  controllers: [
    GpsCheckInController,
    FieldCollectionController,
    CashHandoverController,
    CashReconciliationController,
    OfflineSyncController,
  ],
  providers: [
    GpsCheckInService,
    FieldCollectionService,
    CashCustodyService,
    CashHandoverService,
    CashReconciliationService,
    OfflineSyncService,
  ],
  exports: [GpsCheckInService, CashCustodyService],
})
export class FieldModule {}
