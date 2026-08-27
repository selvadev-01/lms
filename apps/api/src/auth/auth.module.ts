import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { SmsModule } from '../sms/sms.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordPolicyService } from './password-policy.service';
import { PasswordService } from './password.service';
import { RecoveryService } from './recovery.service';
import { SessionManagementService } from './session-management.service';
import { SessionModule } from './session.module';

@Module({
  imports: [
    // Global so the app-wide JwtAuthGuard, which is registered in AppModule,
    // can resolve JwtService without AppModule importing AuthModule's internals.
    JwtModule.register({ global: true }),
    // SessionService moved to its own @Global() module so the same guard can
    // validate sessions per request; AuthModule consumes it like any other.
    SessionModule,
    SmsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    PasswordPolicyService,
    RecoveryService,
    SessionManagementService,
  ],
  exports: [
    AuthService,
    PasswordService,
    PasswordPolicyService,
    RecoveryService,
    SessionManagementService,
  ],
})
export class AuthModule {}
