import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { networkInterfaces } from 'os';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProd = process.env.NODE_ENV === 'production';
  const port   = parseInt(process.env.PORT ?? '4000', 10);

  const app = await NestFactory.create(AppModule, {
    logger: isProd ? ['error', 'warn'] : ['error', 'warn', 'log', 'debug'],
  });

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
            defaultSrc:     ["'self'"],
            scriptSrc:      ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"],
            scriptSrcAttr:  ["'unsafe-inline'"],   // для this.media='all' (Angular CSS loader)
            styleSrc:       ["'self'", "'unsafe-inline'"],
            imgSrc:         ["'self'", 'data:', 'https:'],
            connectSrc:     ["'self'", 'wss:', 'ws:'],
            fontSrc:        ["'self'"],
            objectSrc:      ["'none'"],
            frameAncestors: ["'none'"],
            baseUri:        ["'self'"],
            formAction:     ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // WASM потребує цього бути вимкненим
      hsts: isProd
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      noSniff:        true,
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

  // Health check endpoint (для Fly.io та моніторингу)
  // Реєструємо ДО CORS та інших middleware — має бути завжди доступний
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/api/health', (_req: any, res: any) => {
    res.status(200).json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      env:       process.env.NODE_ENV,
    });
  });

  // CORS
  const explicitOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true);
      if (explicitOrigins.includes(origin)) return cb(null, true);

      // GitHub Codespaces
      if (/^https:\/\/[a-z0-9-]+-\d+\.app\.github\.dev$/.test(origin)) return cb(null, true);
      if (/^https:\/\/[a-z0-9-]+\.preview\.app\.github\.dev$/.test(origin)) return cb(null, true);

      // Fly.io (власний домен додатку)
      if (isProd && /^https:\/\/[a-z0-9-]+\.fly\.dev$/.test(origin)) return cb(null, true);

      cb(new Error(`CORS: origin '${origin}' not allowed`));
    },
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(port, '0.0.0.0'); // 0.0.0.0 — слухати на всіх інтерфейсах

  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  logger.log(`🚀 Server running in ${process.env.NODE_ENV ?? 'development'} mode`);
  logger.log(`📡 API:    http://localhost:${port}/api`);
  logger.log(`❤️  Health: http://localhost:${port}/api/health`);
  if (!isProd) {
    logger.log(`🌐 LAN:    http://${getLocalIp()}:${port}/api`);
  }
  logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

function getLocalIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'YOUR_LAN_IP';
}

bootstrap();