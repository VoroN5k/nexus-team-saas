import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'node:path';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { TaskModule } from './task/task.module';
import { PrismaModule } from './prisma/prisma.module';
import { VaultModule } from './vault/vault.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),

    // Serve Angular SPA
    // В production (NODE_ENV=production) роздаємо Angular з ./public
    // В development цей модуль не активний — Angular запускається окремо на :3000
    ...(process.env.NODE_ENV === 'production'
      ? [
        ServeStaticModule.forRoot({
          // Шлях до Angular build (dist/client/browser → скопійовано в ./public)
          rootPath: join(__dirname, '..', 'public'),
          // /api/* обробляється NestJS контролерами, все інше → Angular
          exclude: ['/api/(.*)'],
          serveStaticOptions: {
            // Для Angular SPA routing: fallback до index.html
            // (щоб /dashboard, /workspace/:id і т.д. не давали 404)
            fallthrough: false,
            // Cache static assets (JS/CSS/images)
            maxAge: '1d',
            // Але не кешувати index.html — він завжди повинен бути свіжим
            setHeaders: (res, path) => {
              if (path.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
              }
            },
          },
        }),
      ]
      : []),

    PrismaModule,
    AuthModule,
    WorkspaceModule,
    TaskModule,
    VaultModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}