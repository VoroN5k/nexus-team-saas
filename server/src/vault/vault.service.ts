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

        const indices = shares.map(s => s.shareIndex).sort((a, b) => a - b);
        for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i + 1) {
        throw new BadRequestException(
          'Share indices must be unique and span 1..totalShares',
        );
      }
    }
 
    // Validate holder uniqueness
    const holderIds = shares.map(s => s.holderId);
    if (new Set(holderIds).size !== holderIds.length) {
      throw new BadRequestException('Duplicate holder IDs in shares array');
    }
 
    // Validate all holders are workspace members
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: holderIds } },
      select: { userId: true },
    });
 
    if (memberships.length !== holderIds.length) {
      const foundIds = new Set(memberships.map(m => m.userId));
      const missing  = holderIds.filter(id => !foundIds.has(id));
      throw new BadRequestException(
        `The following holder IDs are not workspace members: ${missing.join(', ')}`,
      );
    }
 
    // Create vault + shares in a single transaction
    return this.prisma.$transaction(async (tx) => {
      const vault = await tx.vault.create({
        data: {
          workspaceId,
          createdById,
          name,
          description,
          threshold,
          totalShares,
        },
      });
 
      await tx.vaultShare.createMany({
        data: shares.map(s => ({
          vaultId:         vault.id,
          holderId:        s.holderId,
          shareIndex:      s.shareIndex,
          encryptedShare:  s.encryptedShare,
          holderPublicKey: s.holderPublicKey,
        })),
      });
 
      return this.findVaultById(vault.id, workspaceId, tx);
    });
  }

  async listVaults(workspaceId: string) {
    return this.prisma.vault.findMany({
      where:   { workspaceId },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        shares: {
          select: {
            id:        true,
            shareIndex: true,
            holderId:  true,
            holderPublicKey: true,
            holder: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        _count: { select: { accessRequests: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getVault(vaultId: string, workspaceId: string) {
    const vault = await this.findVaultById(vaultId, workspaceId);
    return vault;
  }
 
  
  async deleteVault(vaultId: string, workspaceId: string, requestingRole: Role) {
    await this.getVault(vaultId, workspaceId); // 404 guard
 
    if (requestingRole === Role.MEMBER) {
      throw new ForbiddenException('Only ADMIN and OWNER can delete vaults');
    }
 
    await this.prisma.vault.delete({ where: { id: vaultId } });
  }
}
