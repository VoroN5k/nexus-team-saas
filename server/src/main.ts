import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProd = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, {
    logger: isProd ? ['error', 'warn'] : ['error', 'warn', 'log', 'debug'],
  });

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:     ["'self'"],
          scriptSrc:      ["'self'"],
          styleSrc:       ["'self'", "'unsafe-inline'"],
          imgSrc:         ["'self'", 'data:', 'https:'],
          connectSrc:     ["'self'"],
          fontSrc:        ["'self'"],
          objectSrc:      ["'none'"],
          frameAncestors: ["'none'"],
          baseUri:        ["'self'"],
          formAction:     ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: isProd,
      hsts: isProd
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      noSniff:        true,
      xssFilter:      true,
      frameguard:     { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hidePoweredBy:  true,
    }),
  );

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,
      forbidNonWhitelisted: true,
      transform:            true,
      transformOptions:     { enableImplicitConversion: false },
      stopAtFirstError:     false,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api');

  // CORS
  // Explicit allowed origins from env (comma-separated).
  const explicitOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map(o => o.trim());

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Allow server-to-server requests (no origin header)
      if (!origin) return cb(null, true);

      // Allow any explicitly listed origin
      if (explicitOrigins.includes(origin)) return cb(null, true);

      // Allow any GitHub Codespaces forwarded-port origin automatically.
      // These look like: https://<name>-<port>.app.github.dev
      if (/^https:\/\/[a-z0-9-]+-\d+\.app\.github\.dev$/.test(origin)) {
        return cb(null, true);
      }

      // Allow any *.preview.app.github.dev (older Codespaces format)
      if (/^https:\/\/[a-z0-9-]+\.preview\.app\.github\.dev$/.test(origin)) {
        return cb(null, true);
      }

      cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  logger.log(`🚀 Server running on http://localhost:${port}/api`);
}

bootstrap();