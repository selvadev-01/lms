import { Global, Module } from '@nestjs/common';

import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';

/**
 * Writing and reading the audit trail.
 *
 * `@Global` because `AuditService` is a dependency of nearly every module — the
 * alternative is an import line in each one, and a module that forgets it simply
 * stops auditing.
 *
 * `AuditQueryService` is a separate class rather than more methods on
 * `AuditService`, and that separation is deliberate: the writer has no read
 * path, and the reader has no write path. Module 17 added the read half; before
 * it, the trail was written comprehensively and could not be read at all.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService, AuditQueryService],
})
export class AuditModule {}
