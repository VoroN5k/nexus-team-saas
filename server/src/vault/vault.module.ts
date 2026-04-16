import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultController } from './vault.controller';
import { VaultGateway } from './vault.gateway';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule, // provides JwtService for WebSocket token verification
  ],
  controllers: [VaultController],
  providers: [
    VaultService,
    VaultGateway,
  ],
  exports: [VaultService],
})
export class VaultModule {}
