import {
  type ExecutionContext,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
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
import signupConfig from './config/signup.config';
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
import { CsrfGuard } from './common/guards/csrf.guard';
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

/**
 * Whether a request is for exactly the given API route.
 *
 * Compared against the path with the `api/v1` prefix and any query string
 * removed, so a bucket names the route as its controller declares it. Matching
 * is exact rather than by prefix: a bucket for `/auth/sign-in` must not also
 * catch some future `/auth/sign-in-with-otp`.
 */
export function isPath(context: ExecutionContext, route: string): boolean {
  const request = context.switchToHttp().getRequest<{ url?: string }>();
  const url = request.url ?? '';
  const path = url.split('?')[0].replace(/^\/api\/v1/, '');
  return path === route;
}

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
        signupConfig,
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
     *
     * # Storage is in-memory, and that is a deployment constraint
     *
     * No `storage` is configured, so counters live in this process. Every limit
     * below is therefore *per instance*: run N replicas and the effective
     * sign-in ceiling is 20N per minute, and a restart resets every counter.
     *
     * That is correct for the single-process deployment this runs as today, and
     * it avoids standing up Redis for a problem that does not yet exist. It
     * stops being correct the moment a second replica is added — at which point
     * this needs a shared store (`@nest-lab/throttler-storage-redis`), and the
     * per-account lockout in `AuthService` becomes the only limit that still
     * holds, because that one is enforced in the database.
     *
     * `TRUSTED_PROXY_HOPS` must also be set before any of these limits mean
     * anything behind a load balancer — see `main.ts`.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        // 60 was sized for screens that make one or two requests. The Module 18
        // dashboard makes nine — the layout plus one per widget, deliberately,
        // so a single widget can fail and retry on its own — which put two page
        // views a minute over the limit. The trailing widgets then 429 and the
        // page renders them as "could not be loaded", reading as a widget bug
        // rather than as the rate limit it is.
        //
        // Read through ConfigService like every other limit here. It was read
        // from `process.env` directly at first, on the assumption that this
        // factory runs after ConfigModule has populated it. That assumption was
        // wrong, and wrong silently: `DEFAULT_RATE_LIMIT` was undefined at this
        // point, so a deployment that configured it got the default anyway and
        // nothing reported the discrepancy. A `registerAs` factory is evaluated
        // once ConfigModule has loaded the file, which is why the value belongs
        // there rather than here.
        {
          name: 'default',
          ttl: 60_000,
          limit: config.get<number>('auth.defaultRateLimit') ?? 240,
        },
        /**
         * # Every named bucket below is confined to its own route
         *
         * `@nestjs/throttler` applies EVERY configured bucket to EVERY route
         * unless that route opts out. Without `skipIf` the signup bucket — three
         * per minute, correctly strict for creating an organization — also
         * capped the dashboard, the customer list and every other endpoint in
         * the application at three requests per minute.
         *
         * That was not theoretical: it is what produced "This widget could not
         * be loaded" and "We could not load your organization" on the second
         * page view of anything. The `default: MAX_SAFE_INTEGER` escape in
         * `auth.controller.ts` only ever addressed the mirror image of this —
         * one route escaping `default` — and could not have fixed it, because
         * the leak is the other direction and reaches all 158 decorated routes.
         *
         * Confining each bucket at its definition is the fix that scales: a new
         * controller cannot forget an opt-out it never has to write.
         */
        {
          name: 'recoveryRequest',
          ttl: 60_000,
          limit: config.get<number>('auth.recoveryRequestRateLimit') ?? 5,
          skipIf: (context) => !isPath(context, '/auth/forgot-password'),
        },
        {
          name: 'recoveryVerify',
          ttl: 60_000,
          limit: config.get<number>('auth.recoveryVerifyRateLimit') ?? 10,
          skipIf: (context) => !isPath(context, '/auth/verify-otp'),
        },
        // Named rather than left to `@Throttle({ default: ... })` for the same
        // reason the recovery limits are: decorator arguments are evaluated when
        // the class is defined, before ConfigModule has read `.env`, so a
        // configured value cannot reach one.
        {
          name: 'signIn',
          ttl: 60_000,
          limit: config.get<number>('auth.signInRateLimit') ?? 20,
          skipIf: (context) => !isPath(context, '/auth/sign-in'),
        },
        // Creating an organization is a once-per-lifetime act, and each one
        // writes several hundred rows and burns an argon2 hash. Much stricter
        // than sign-in for that reason.
        {
          name: 'signup',
          ttl: 60_000,
          limit: config.get<number>('signup.rateLimit') ?? 3,
          skipIf: (context) => !isPath(context, '/auth/sign-up'),
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
    // Before authentication: a forged request should be refused on its shape
    // alone, without the session lookup that JwtAuthGuard would otherwise do on
    // its behalf.
    { provide: APP_GUARD, useClass: CsrfGuard },
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
