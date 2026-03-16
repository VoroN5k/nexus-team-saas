import { Module } from '@nestjs/common';
import { AuthService } from './auth/auth.service';

@Module({
  imports: [],
  controllers: [],
  providers: [AuthService],
})
export class AppModule {}
