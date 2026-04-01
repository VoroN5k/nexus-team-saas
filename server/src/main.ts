import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
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
      noSniff:       true,
      xssFilter:     true,
      frameguard:    { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hidePoweredBy: true,
    }),
  );

  // Cookie Parser
  app.use(cookieParser());

  // Validation
  // whitelist strips unknown props, forbidNonWhitelisted rejects them
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:              true,
      forbidNonWhitelisted:   true,
      transform:              true,
      transformOptions:       { enableImplicitConversion: false },
      stopAtFirstError:       false,
    }),
  );

  // Global Exception Filter
  // Prevents leaking stack traces / internal details in production
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global Prefix
  app.setGlobalPrefix('api');

  // CORS
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map(o => o.trim());

  app.enableCors({
    origin: (origin, cb) => {
      // Allow server-to-server (no origin) and explicitly listed origins only
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error(`CORS: origin '${origin}' not allowed`));
      }
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