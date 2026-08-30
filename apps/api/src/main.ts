import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());
  // Session auth is cookie-based, so cookies must be parsed before any guard.
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');

  /**
   * How many reverse proxies sit in front of this process.
   *
   * Express derives `req.ip` from the right-hand end of `X-Forwarded-For`,
   * counting back this many hops. It matters twice over:
   *
   *  - **The rate limiter keys on `req.ip`.** Left at 0 behind a load balancer,
   *    every request appears to come from the balancer, so one caller's traffic
   *    exhausts the per-IP budget for everyone and the limits protect nothing.
   *  - **Audit records store it.** A failed sign-in attributed to the balancer
   *    cannot be traced to whoever actually made it.
   *
   * Deliberately a count and not `true`: `true` trusts the whole chain, so a
   * client can prepend any `X-Forwarded-For` it likes and choose its own
   * apparent address — which forges exactly the two things above. The default
   * of 0 is correct for a directly exposed process; a deployment behind one
   * proxy sets 1.
   */
  const proxyHops = config.get<number>('auth.trustedProxyHops') ?? 0;
  if (proxyHops > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', proxyHops);
  }

  app.enableCors({
    origin: config.get<string>('auth.webOrigin'),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` is a security control, not tidiness: it strips properties
      // that have no DTO decorator, so a caller cannot smuggle extra fields
      // (e.g. a status override) into a request body.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
