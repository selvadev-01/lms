import { Global, Module } from '@nestjs/common';

import { AuthorizationService } from './authorization.service';

/**
 * Global for the same reason PrismaModule, AuditModule and SessionModule are:
 * the app-wide JwtAuthGuard and PermissionsGuard are registered in AppModule and
 * must resolve AuthorizationService on every request, without AppModule importing
 * AuthModule — which would be a cycle, since AuthModule's own controller sits
 * behind those guards.
 */
@Global()
@Module({
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
