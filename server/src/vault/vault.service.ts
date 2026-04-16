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

  async createVault(
    workspaceId: string,
    createdById: string,
    dto: CreateVaultDto,
  ) {
    const { name, description, threshold, totalShares, shares } = dto;

    if (threshold > totalShares)
      throw new BadRequestException('theshold must e < total Shares');

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

    // Validate holder uniqueness
    const holderIds = shares.map((s) => s.holderId);
    if (new Set(holderIds).size !== holderIds.length) {
      throw new BadRequestException('Duplicate holder IDs in shares array');
    }

    // Validate all holders are workspace members
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
    const vault = await this.findVaultById(vaultId, workspaceId);
    return vault;
  }

  async deleteVault(
    vaultId: string,
    workspaceId: string,
    requestingRole: Role,
  ) {
    await this.getVault(vaultId, workspaceId); // 404 guard

    if (requestingRole === Role.MEMBER) {
      throw new ForbiddenException('Only ADMIN and OWNER can delete vaults');
    }

    await this.prisma.vault.delete({ where: { id: vaultId } });
  }

  /**
   * Return the encrypted share assigned to a specific holder for a vault.
   * The holder's client uses their private key to decrypt it locally,
   * then submits the plaintext share to complete an access request.
   */

  async getMyEncryptedShare(
    vaultId: string,
    workspaceId: string,
    userId: string,
  ) {
    await this.getVault(vaultId, workspaceId); // workspace scope check

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

  //Access Requests
  /**
   * Create a new access request for a vault.
   * Returns the full request with share metadata so the caller can notify
   * holders via the WebSocket gateway.
   */

  async createAccessRequest(
    vaultId: string,
    workspaceId: string,
    requesterId: string,
    dto: CreateAccessRequestDto,
  ) {
    const vault = await this.getVault(vaultId, workspaceId);

    // Check if there is already an active (PENDING) request from this user
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

  /** Get the current status of an access request, including submission count. */
  async getAccessRequest(
    accessRequestId: string,
    vaultId: string,
    workspaceId: string,
  ) {
    await this.getVault(vaultId, workspaceId); // scope check

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

  /** List access requests for a vault (metadata only — no share content). */
  async listAccessRequests(vaultId: string, workspaceId: string) {
    await this.getVault(vaultId, workspaceId);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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

  /**
   * A key holder submits their decrypted SSS share.
   *
   * Flow:
   *   1. Validate the request is still PENDING and not expired.
   *   2. Confirm the submitter is actually a holder for this vault.
   *   3. Persist the share submission (upsert — idempotent).
   *   4. Count submissions — if threshold reached:
   *        a. Mark request as APPROVED.
   *        b. Collect all plaintext shares.
   *        c. Return them so the gateway can forward to the requester.
   *        d. Purge ShareSubmission rows immediately.
   *
   * Returns null if threshold not yet met, or QuorumReachedPayload if it is.
   */

  async submitShare(
    accessRequestId: string,
    vaultId: string,
    workspaceId: string,
    holderId: string,
    dto: SubmitShareDto,
  ): Promise<QuorumReachedPayload | null> {
    // ── Validate vault scope
    await this.getVault(vaultId, workspaceId);

    return this.prisma.$transaction(async (tx) => {
      // ── Load request with write lock (serialisable)
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

      // ── Confirm submitter is a designated holder
      const holderShare = await tx.vaultShare.findUnique({
        where: { vaultId_holderId: { vaultId, holderId } },
      });

      if (!holderShare) {
        throw new ForbiddenException('You are not a key holder for this vault');
      }

      // ── Upsert submission (idempotent — holder may re-submit same share)
      await tx.shareSubmission.upsert({
        where: { accessRequestId_holderId: { accessRequestId, holderId } },
        create: { accessRequestId, holderId, share: dto.share },
        update: { share: dto.share },
      });

      // ── Recount submissions after upsert
      const allSubmissions = await tx.shareSubmission.findMany({
        where: { accessRequestId },
      });

      const submissionCount = allSubmissions.length;
      const threshold = request.vault.threshold;

      this.logger.log(
        `Vault ${vaultId} access request ${accessRequestId}: ` +
          `${submissionCount}/${threshold} shares collected`,
      );

      // ── Threshold not yet met — return null
      if (submissionCount < threshold) {
        return null;
      }

      // ── Quorum reached — collect shares and mark APPROVED
      await tx.accessRequest.update({
        where: { id: accessRequestId },
        data: { status: AccessRequestStatus.APPROVED },
      });

      const sharesPayload = allSubmissions.map((s) => ({
        holderId: s.holderId,
        share: s.share,
      }));

      // ── Purge ephemeral share submissions immediately
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

  /**
   * Deny or cancel a pending access request.
   * Only ADMIN/OWNER or the original requester can cancel.
   */

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

  /**
   * Background cleanup: mark all PENDING requests past their expiresAt as EXPIRED.
   * Call this from a scheduled job (e.g. @nestjs/schedule) or on-demand.
   */
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

  // Private Helpers
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
