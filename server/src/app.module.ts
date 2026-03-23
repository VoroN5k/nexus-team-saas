import { Module } from '@nestjs/common';
import { AuthService } from './auth/auth.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { EmailModule } from './auth/email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true,}),
    AuthModule,
    EmailModule
  ],
  controllers: [],
  providers: [AuthService],
})
export class AppModule {}
