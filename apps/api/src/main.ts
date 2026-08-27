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
