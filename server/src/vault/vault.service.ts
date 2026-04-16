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
  shares: Array<{ holderId: string; shareIndex: number; share: string }>;
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(private readonly prisma: PrismaService) {}

  //Vault CRUD

  async createVault(
    workspaceId: string,
    createdById: string,
    dto: CreateVaultDto,
  ) {
    const { name, description, threshold, totalShares, shares } = dto;

    if (threshold > totalShares)
      throw new BadRequestException('threshold must be <= totalShares');

    if (shares.length !== totalShares)
      throw new BadRequestException(
        `Expected ${totalShares} shares but received ${shares.length}`,
      );

    const indices = shares.map((s) => s.shareIndex).sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i + 1) {
        throw new BadRequestException(
          'Share indices must be unique and span 1..totalShares',
        );
      }
    }

    const holderIds = shares.map((s) => s.holderId);
    if (new Set(holderIds).size !== holderIds.length) {
      throw new BadRequestException('Duplicate holder IDs in shares array');
    }

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: holderIds } },
      select: { userId: true },
    });

    if (memberships.length !== holderIds.length) {
      const foundIds = new Set(memberships.map((m) => m.userId));
      const missing = holderIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(
        `The following holder IDs are not workspace members: ${missing.join(', ')}`,
      );
    }

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
        data: shares.map((s) => ({
          vaultId: vault.id,
          holderId: s.holderId,
          shareIndex: s.shareIndex,
          encryptedShare: s.encryptedShare,
          holderPublicKey: s.holderPublicKey,
        })),
      });

      return this.findVaultById(vault.id, workspaceId, tx);
    });
  }

  async listVaults(workspaceId: string) {
    return this.prisma.vault.findMany({
      where: { workspaceId },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        shares: {
          select: {
            id: true,
            shareIndex: true,
            holderId: true,
            holderPublicKey: true,
            holder: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        _count: { select: { accessRequests: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getVault(vaultId: string, workspaceId: string) {
    return this.findVaultById(vaultId, workspaceId);
  }

  async deleteVault(
    vaultId: string,
    workspaceId: string,
    requestingRole: Role,
  ) {
    await this.getVault(vaultId, workspaceId);

    if (requestingRole === Role.MEMBER) {
      throw new ForbiddenException('Only ADMIN and OWNER can delete vaults');
    }

    await this.prisma.vault.delete({ where: { id: vaultId } });
  }

  async getMyEncryptedShare(
    vaultId: string,
    workspaceId: string,
    userId: string,
  ) {
    await this.getVault(vaultId, workspaceId);

    const share = await this.prisma.vaultShare.findUnique({
      where: { vaultId_holderId: { vaultId, holderId: userId } },
      select: {
        id: true,
        shareIndex: true,
        encryptedShare: true,
        holderPublicKey: true,
      },
    });

    if (!share) {
      throw new NotFoundException('You are not a key holder for this vault');
    }

    return share;
  }

  async createAccessRequest(
    vaultId: string,
    workspaceId: string,
    requesterId: string,
    dto: CreateAccessRequestDto,
  ) {
    const vault = await this.getVault(vaultId, workspaceId);

    const existing = await this.prisma.accessRequest.findFirst({
      where: {
        vaultId,
        requesterId,
        status: AccessRequestStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });

    if (existing) {
      throw new ConflictException(
        'You already have an active access request for this vault',
      );
    }

    const expiresAt = new Date(Date.now() + ACCESS_REQUEST_TTL_MS);

    const request = await this.prisma.accessRequest.create({
      data: { vaultId, requesterId, expiresAt },
      include: {
        vault: {
          select: { id: true, name: true, threshold: true, totalShares: true },
        },
        requester: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return {
      ...request,
      reason: dto.reason,
      holders: vault.shares.map((s: any) => ({
        holderId: s.holderId,
        holderPublicKey: s.holderPublicKey,
        holder: s.holder,
      })),
    };
  }

  async getAccessRequest(
    accessRequestId: string,
    vaultId: string,
    workspaceId: string,
  ) {
    await this.getVault(vaultId, workspaceId);

    const request = await this.prisma.accessRequest.findUnique({
      where: { id: accessRequestId },
      include: {
        vault: {
          select: { id: true, name: true, threshold: true, totalShares: true },
        },
        requester: { select: { id: true, firstName: true, lastName: true } },
        submissions: {
          select: {
            holderId: true,
            submittedAt: true,
            holder: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!request || request.vaultId !== vaultId) {
      throw new NotFoundException('Access request not found');
    }

    return request;
  }

  async listAccessRequests(vaultId: string, workspaceId: string) {
    await this.getVault(vaultId, workspaceId);

    return this.prisma.accessRequest.findMany({
      where: { vaultId },
      include: {
        requester: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        submissions: { select: { holderId: true, submittedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitShare(
    accessRequestId: string,
    vaultId: string,
    workspaceId: string,
    holderId: string,
    dto: SubmitShareDto,
  ): Promise<QuorumReachedPayload | null> {
    await this.getVault(vaultId, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.accessRequest.findUnique({
        where: { id: accessRequestId },
        include: {
          vault: true,
          submissions: true,
        },
      });

      if (!request || request.vaultId !== vaultId) {
        throw new NotFoundException('Access request not found');
      }

      if (request.status !== AccessRequestStatus.PENDING) {
        throw new BadRequestException(
          `Access request is already ${request.status.toLowerCase()}`,
        );
      }

      if (request.expiresAt < new Date()) {
        await tx.accessRequest.update({
          where: { id: accessRequestId },
          data: { status: AccessRequestStatus.EXPIRED },
        });
        throw new BadRequestException('Access request has expired');
      }

      const holderShare = await tx.vaultShare.findUnique({
        where: { vaultId_holderId: { vaultId, holderId } },
      });

      if (!holderShare) {
        throw new ForbiddenException('You are not a key holder for this vault');
      }

      await tx.shareSubmission.upsert({
        where: { accessRequestId_holderId: { accessRequestId, holderId } },
        create: { accessRequestId, holderId, share: dto.share },
        update: { share: dto.share },
      });

      const allSubmissions = await tx.shareSubmission.findMany({
        where: { accessRequestId },
      });

      const submissionCount = allSubmissions.length;
      const threshold = request.vault.threshold;

      this.logger.log(
        `Vault ${vaultId} access request ${accessRequestId}: ` +
        `${submissionCount}/${threshold} shares collected`,
      );

      if (submissionCount < threshold) {
        return null;
      }

      await tx.accessRequest.update({
        where: { id: accessRequestId },
        data: { status: AccessRequestStatus.APPROVED },
      });

      const vaultShares = await tx.vaultShare.findMany({
        where: { vaultId, holderId: { in: allSubmissions.map(s => s.holderId) } },
        select: { holderId: true, shareIndex: true },
      });

      const indexByHolder = new Map(vaultShares.map(s => [s.holderId, s.shareIndex]));

      const sharesPayload = allSubmissions.map((s) => ({
        holderId: s.holderId,
        shareIndex: indexByHolder.get(s.holderId) ?? 1,
        share: s.share,
      }));

      await tx.shareSubmission.deleteMany({ where: { accessRequestId } });

      this.logger.log(
        `Vault ${vaultId}: quorum reached for request ${accessRequestId}. ` +
        `Shares purged from DB after forwarding.`,
      );

      return {
        accessRequestId,
        vaultId,
        requesterId: request.requesterId,
        shares: sharesPayload,
      };
    });
  }

  async denyAccessRequest(
    accessRequestId: string,
    vaultId: string,
    workspaceId: string,
    userId: string,
    role: Role,
  ) {
    await this.getVault(vaultId, workspaceId);

    const request = await this.prisma.accessRequest.findUnique({
      where: { id: accessRequestId },
    });

    if (!request || request.vaultId !== vaultId) {
      throw new NotFoundException('Access request not found');
    }

    if (request.status !== AccessRequestStatus.PENDING) {
      throw new BadRequestException(
        `Request is already ${request.status.toLowerCase()}`,
      );
    }

    const isPrivileged = role === Role.ADMIN || role === Role.OWNER;
    const isSelf = request.requesterId === userId;

    if (!isPrivileged && !isSelf) {
      throw new ForbiddenException('You cannot deny this access request');
    }

    return this.prisma.accessRequest.update({
      where: { id: accessRequestId },
      data: { status: AccessRequestStatus.DENIED },
    });
  }

  async expireStaleRequests() {
    const { count } = await this.prisma.accessRequest.updateMany({
      where: {
        status: AccessRequestStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: AccessRequestStatus.EXPIRED },
    });

    if (count > 0) {
      this.logger.log(`Expired ${count} stale access request(s)`);
    }
  }

  private async findVaultById(vaultId: string, workspaceId: string, tx?: any) {
    const db = tx ?? this.prisma;

    const vault = await db.vault.findUnique({
      where: { id: vaultId },
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        shares: {
          select: {
            id: true,
            shareIndex: true,
            holderId: true,
            holderPublicKey: true,
            holder: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
          orderBy: { shareIndex: 'asc' },
        },
      },
    });

    if (!vault || vault.workspaceId !== workspaceId) {
      throw new NotFoundException('Vault not found');
    }

    return vault;
  }
}