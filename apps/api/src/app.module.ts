import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import authConfig from './config/auth.config';
import customersConfig from './config/customers.config';
import fieldConfig from './config/field.config';
import maintenanceConfig from './config/maintenance.config';
import notificationsConfig from './config/notifications.config';
import { validateEnv } from './config/env.validation';
import { CustomersModule } from './customers/customers.module';
import { LoansModule } from './loans/loans.module';
import { AccountingModule } from './accounting/accounting.module';
import { MasterDataModule } from './master-data/master-data.module';
import { RecoveryModule } from './recovery/recovery.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { FieldModule } from './field/field.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { AuthorizationModule } from './common/authorization/authorization.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MaintenanceModeGuard } from './common/guards/maintenance-mode.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { SettingsModule } from './settings/settings.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { EmailModule } from './email/email.module';
import { NotificationEventsModule } from './notifications/ingestion/notification-events.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        authConfig,
        fieldConfig,
        customersConfig,
        notificationsConfig,
        maintenanceConfig,
      ],
      validate: validateEnv,
    }),
    /**
     * Blunts online brute force that the per-account lockout alone cannot
     * cover, e.g. one attempt each against many different accounts (Q-AUTH-10).
     *
     * Registered async so the recovery limits can come from ConfigService.
     * `@Throttle({ limit })` cannot: decorator arguments are evaluated when the
     * class is defined, before ConfigModule has loaded `.env`, so a configured
     * value would be silently ignored in favour of the literal in the source.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        { name: 'default', ttl: 60_000, limit: 60 },
        {
          name: 'recoveryRequest',
          ttl: 60_000,
          limit: config.get<number>('auth.recoveryRequestRateLimit') ?? 5,
        },
        {
          name: 'recoveryVerify',
          ttl: 60_000,
          limit: config.get<number>('auth.recoveryVerifyRateLimit') ?? 10,
        },
        // Named rather than left to `@Throttle({ default: ... })` for the same
        // reason the recovery limits are: decorator arguments are evaluated when
        // the class is defined, before ConfigModule has read `.env`, so a
        // configured value cannot reach one.
        {
          name: 'signIn',
          ttl: 60_000,
          limit: config.get<number>('auth.signInRateLimit') ?? 20,
        },
      ],
    }),
    PrismaModule,
    AuditModule,
    // Before AuthModule: both global guards resolve AuthorizationService, and
    // AuthService reuses it so "effective permissions" has one definition rather
    // than one per call site.
    AuthorizationModule,
    AuthModule,
    FieldModule,
    OrganizationsModule,
    UsersModule,
    CustomersModule,
    LoansModule,
    MasterDataModule,
    SettingsModule,
    MaintenanceModule,
    AccountingModule,
    RecoveryModule,
    ReportsModule,
    /**
     * Module 16 infrastructure.
     *
     * `QueueModule` is `@Global` so a business module can enqueue without
     * acquiring a dependency on notification infrastructure — the coupling
     * Rules 60-62 exist to prevent. `EmailModule` exports only its facade, as
     * `SmsModule` does, and is imported by the notification dispatch service
     * rather than by any business module.
     */
    QueueModule,
    EmailModule,
    /**
     * The emit half is @Global and depends on nothing of the business modules,
     * so they can raise events without importing Module 16. The processing half
     * depends on them — it resolves ASSIGNED_USER and RECORD_OWNER recipients
     * from live source rows — and is registered after them for that reason.
     */
    NotificationEventsModule,
    NotificationsModule,
    /**
     * Module 18 reads through `ReportsModule`'s `KpiService`, so it is
     * registered after it — the convention this array follows throughout, that
     * a consumer appears below the module it consumes.
     */
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Authentication runs before authorization; both are global so a new route
    // is protected by default rather than by remembering to add a decorator.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Module 17. MUST stay last: Nest applies global guards in registration
    // order, so this runs only after the caller has been authenticated AND
    // authorized. That is what makes Rule 78 and Scenario 33 structural —
    // maintenance mode can only subtract access, never grant it, and a caller
    // lacking a permission gets 403 from the guard above rather than 503 from
    // this one. Moving this line up looks cosmetic and is not.
    { provide: APP_GUARD, useClass: MaintenanceModeGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
