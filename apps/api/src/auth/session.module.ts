import { Global, Module } from '@nestjs/common';

import { SessionService } from './session.service';

/**
 * Global for the same reason PrismaModule and AuditModule are: the app-wide
 * JwtAuthGuard is registered in AppModule and must resolve SessionService to
 * validate the session behind every request, without AppModule importing
 * AuthModule — which would be a cycle, since AuthModule's own controller sits
 * behind that guard.
 *
 * SessionService lives in its own module rather than AuthModule for that
 * reason alone; AuthModule still imports it and re-exports nothing new.
 */
@Global()
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
