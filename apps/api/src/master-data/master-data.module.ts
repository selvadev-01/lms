import { Module } from '@nestjs/common';

import { MasterDataController } from './master-data.controller';
import { MasterDataService } from './master-data.service';

/**
 * Master data — the admin-maintained option lists behind dropdown fields.
 *
 * Imports nothing: PrismaModule and AuditModule are both `@Global`.
 *
 * `MasterDataService` is exported so other modules can resolve a code to its
 * label, or check that a submitted value is still active, without each of them
 * reaching into the table directly.
 */
@Module({
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}
