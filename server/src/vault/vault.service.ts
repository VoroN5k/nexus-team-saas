import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccessRequestStatus, Role } from '../../generated/prisma/client';
import {
  CreateVaultDto,
  CreateAccessRequestDto,
  SubmitShareDto,
} from './dto/vault.dto';

const ACCESS_REQUEST_TTL_MS = 60 * 60 * 1_000;

export interface QuorumReachedPayload {
    accessRequestId: string;
    vaultId: string;
    requesterId: string;
    shares: Array<{ holderId: string; share: string }>;
}

@Injectable()
export class VaultService {
    private readonly logger = new Logger(VaultService.name);

    constructor(private readonly prisma: PrismaService) {}

    //Vault CRUD

    async createVault(workspaceId: string, createdById: string, dto: CreateVaultDto){
        const { name, description, threshold, totalShares, shares } = dto;

        if (threshold > totalShares) throw new BadRequestException('theshold must e < total Shares');

        if (shares.length !== totalShares) throw new BadRequestException(`Expected ${totalShares} shares but received ${shares.length}`)

            
    }
}
