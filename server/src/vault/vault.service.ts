import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccessRequestStatus, Role, RotationRequestStatus } from '../../generated/prisma/client';
import {
  CreateVaultDto,
  CreateAccessRequestDto,
  SubmitShareDto,
  CreateRotationRequestDto,
  SubmitRotationShareDto,
  FinalizeRotationDto,
} from './dto/vault.dto';

const ACCESS_REQUEST_TTL_MS  = 60 * 60 * 1_000;       // 1 hour
const ROTATION_REQUEST_TTL_MS = 24 * 60 * 60 * 1_000;  // 24 hours
const HOLDER_STALE_DAYS      = 30;

export interface QuorumReachedPayload {
  accessRequestId: string;
  vaultId: string;
  requesterId: string;
  shares: Array<{ holderId: string; shareIndex: number; share: string }>;
}

export interface RotationQuorumPayload {
  rotationRequestId: string;
  vaultId: string;
  requesterId: string;
  /** Plaintext shares for the requester to reconstruct the secret */
  shares: Array<{ holderId: string; shareIndex: number; share: string }>;
  /** Current public keys of all holders — requester re-encrypts each one */
  holderPublicKeys: Array<{ holderId: string; publicKey: string }>;
  threshold: number;
  totalShares: number;
}

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Vault CRUD ──────────────────────────────────────────────────────────────

  async createVault(workspaceId: string, createdById: string, dto: CreateVaultDto) {
    const { name, description, threshold, totalShares, shares } = dto;

    if (threshold > totalShares)
      throw new BadRequestException('threshold must be <= totalShares');

    if (shares.length !== totalShares)
      throw new BadRequestException(
        `Expected ${totalShares} shares but received ${shares.length}`,
      );

    const indices = shares.map(s => s.shareIndex).sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i + 1)
        throw new BadRequestException('Share indices must be unique and span 1..totalShares');
    }

    const holderIds = shares.map(s => s.holderId);
    if (new Set(holderIds).size !== holderIds.length)
      throw new BadRequestException('Duplicate holder IDs in shares array');

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

    return this.prisma.$transaction(async tx => {
      const vault = await tx.vault.create({
        data: { workspaceId, createdById, name, description, threshold, totalShares },
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
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        shares: {
          select: {
            id: true, shareIndex: true, holderId: true, holderPublicKey: true,
            holder: { select: { id: true, firstName: true, lastName: true, email: true } },
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

  async deleteVault(vaultId: string, workspaceId: string, requestingRole: Role) {
    await this.getVault(vaultId, workspaceId);
    if (requestingRole === Role.MEMBER)
      throw new ForbiddenException('Only ADMIN and OWNER can delete vaults');
    await this.prisma.vault.delete({ where: { id: vaultId } });
  }

  async getMyEncryptedShare(vaultId: string, workspaceId: string, userId: string) {
    await this.getVault(vaultId, workspaceId);

    const share = await this.prisma.vaultShare.findUnique({
      where: { vaultId_holderId: { vaultId, holderId: userId } },
      select: { id: true, shareIndex: true, encryptedShare: true, holderPublicKey: true },
    });

    if (!share) throw new NotFoundException('You are not a key holder for this vault');
    return share;
  }

  // Holder Health Check

  /**
   * Returns activity status for every holder of a vault.
   * A holder is considered "at risk" if lastSeenAt is null or > HOLDER_STALE_DAYS ago.
   * The owner can use this to proactively rotate shares before quorum is lost.
   */
  async getHolderHealth(vaultId: string, workspaceId: string) {
    const vault = await this.findVaultById(vaultId, workspaceId);
    const staleThreshold = new Date(Date.now() - HOLDER_STALE_DAYS * 24 * 60 * 60 * 1_000);

    const holderIds = vault.shares.map((s: any) => s.holderId);
    const users = await this.prisma.user.findMany({
      where:  { id: { in: holderIds } },
      select: { id: true, firstName: true, lastName: true, email: true, lastSeenAt: true },
    });

    return users.map(u => ({
      holderId:   u.id,
      firstName:  u.firstName,
      lastName:   u.lastName,
      email:      u.email,
      lastSeenAt: u.lastSeenAt,
      isStale:    !u.lastSeenAt || u.lastSeenAt < staleThreshold,
      daysInactive: u.lastSeenAt
        ? Math.floor((Date.now() - u.lastSeenAt.getTime()) / (24 * 60 * 60 * 1_000))
        : null,
    }));
  }

  // Access Requests

  async createAccessRequest(
    vaultId: string,
    workspaceId: string,
    requesterId: string,
    dto: CreateAccessRequestDto,
  ) {
    const vault = await this.getVault(vaultId, workspaceId);

    const existing = await this.prisma.accessRequest.findFirst({
      where: { vaultId, requesterId, status: AccessRequestStatus.PENDING, expiresAt: { gt: new Date() } },
    });
    if (existing) throw new ConflictException('You already have an active access request for this vault');

    const expiresAt = new Date(Date.now() + ACCESS_REQUEST_TTL_MS);
    const request   = await this.prisma.accessRequest.create({
      data:    { vaultId, requesterId, expiresAt },
      include: {
        vault:     { select: { id: true, name: true, threshold: true, totalShares: true } },
        requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return {
      ...request,
      reason:  dto.reason,
      holders: vault.shares.map((s: any) => ({
        holderId:       s.holderId,
        holderPublicKey: s.holderPublicKey,
        holder:         s.holder,
      })),
    };
  }

  async getAccessRequest(accessRequestId: string, vaultId: string, workspaceId: string) {
    await this.getVault(vaultId, workspaceId);

    const request = await this.prisma.accessRequest.findUnique({
      where:   { id: accessRequestId },
      include: {
        vault:       { select: { id: true, name: true, threshold: true, totalShares: true } },
        requester:   { select: { id: true, firstName: true, lastName: true } },
        submissions: {
          select: {
            holderId: true, submittedAt: true,
            holder: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!request || request.vaultId !== vaultId) throw new NotFoundException('Access request not found');
    return request;
  }

  async listAccessRequests(vaultId: string, workspaceId: string) {
    await this.getVault(vaultId, workspaceId);

    return this.prisma.accessRequest.findMany({
      where:   { vaultId },
      include: {
        requester:   { select: { id: true, firstName: true, lastName: true, email: true } },
        submissions: { select: { holderId: true, submittedAt: true } },
        vault:       { select: { id: true, name: true, threshold: true, totalShares: true } },
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

    return this.prisma.$transaction(async tx => {
      const request = await tx.accessRequest.findUnique({
        where:   { id: accessRequestId },
        include: { vault: true, submissions: true },
      });

      if (!request || request.vaultId !== vaultId) throw new NotFoundException('Access request not found');
      if (request.status !== AccessRequestStatus.PENDING)
        throw new BadRequestException(`Access request is already ${request.status.toLowerCase()}`);

      if (request.expiresAt < new Date()) {
        await tx.accessRequest.update({ where: { id: accessRequestId }, data: { status: AccessRequestStatus.EXPIRED } });
        throw new BadRequestException('Access request has expired');
      }

      const holderShare = await tx.vaultShare.findUnique({
        where: { vaultId_holderId: { vaultId, holderId } },
      });
      if (!holderShare) throw new ForbiddenException('You are not a key holder for this vault');

      await tx.shareSubmission.upsert({
        where:  { accessRequestId_holderId: { accessRequestId, holderId } },
        create: { accessRequestId, holderId, share: dto.share },
        update: { share: dto.share },
      });

      const allSubmissions = await tx.shareSubmission.findMany({ where: { accessRequestId } });
      const threshold      = request.vault.threshold;

      this.logger.log(
        `Vault ${vaultId} access request ${accessRequestId}: ${allSubmissions.length}/${threshold} shares`,
      );

      if (allSubmissions.length < threshold) return null;

      await tx.accessRequest.update({
        where: { id: accessRequestId },
        data:  { status: AccessRequestStatus.APPROVED },
      });

      const vaultShares    = await tx.vaultShare.findMany({
        where:  { vaultId, holderId: { in: allSubmissions.map(s => s.holderId) } },
        select: { holderId: true, shareIndex: true },
      });
      const indexByHolder  = new Map(vaultShares.map(s => [s.holderId, s.shareIndex]));
      const sharesPayload  = allSubmissions.map(s => ({
        holderId:   s.holderId,
        shareIndex: indexByHolder.get(s.holderId) ?? 1,
        share:      s.share,
      }));

      await tx.shareSubmission.deleteMany({ where: { accessRequestId } });

      this.logger.log(`Vault ${vaultId}: quorum reached, shares purged after forwarding`);

      return { accessRequestId, vaultId, requesterId: request.requesterId, shares: sharesPayload };
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

    const request = await this.prisma.accessRequest.findUnique({ where: { id: accessRequestId } });
    if (!request || request.vaultId !== vaultId) throw new NotFoundException('Access request not found');
    if (request.status !== AccessRequestStatus.PENDING)
      throw new BadRequestException(`Request is already ${request.status.toLowerCase()}`);

    const isPrivileged = role === Role.ADMIN || role === Role.OWNER;
    if (!isPrivileged && request.requesterId !== userId)
      throw new ForbiddenException('You cannot deny this access request');

    return this.prisma.accessRequest.update({
      where: { id: accessRequestId },
      data:  { status: AccessRequestStatus.DENIED },
    });
  }

  // Key Rotation

  /**
   * A holder whose key pair has changed (new device / fresh browser) requests
   * that the other holders re-encrypt their shares so the vault becomes accessible again.
   *
   * Rotation requires k-1 submissions from OTHER holders (threshold - 1 + the requester's
   * own new share that the server generates after the secret is reconstructed).
   * We simplify by requiring k submissions from ANY other holders — the server
   * enforces that the requester cannot submit their own share.
   */
  async createRotationRequest(
    vaultId: string,
    workspaceId: string,
    requesterId: string,
    dto: CreateRotationRequestDto,
  ) {
    const vault = await this.getVault(vaultId, workspaceId);

    // Requester must currently be a holder
    const myShare = vault.shares.find((s: any) => s.holderId === requesterId);
    if (!myShare) throw new ForbiddenException('You are not a key holder for this vault');

    // Rotation with threshold === totalShares is impossible (requester can't submit)
    if (vault.threshold >= vault.totalShares) {
      throw new BadRequestException(
        `Cannot rotate: threshold (${vault.threshold}) equals total shares (${vault.totalShares}). ` +
        'At least one other holder would need to be added before rotation is possible.',
      );
    }

    // Only one active rotation per vault+requester
    const existing = await this.prisma.shareRotationRequest.findFirst({
      where: {
        vaultId,
        requesterId,
        status:    RotationRequestStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
    });
    if (existing) throw new ConflictException('You already have an active rotation request for this vault');

    const expiresAt = new Date(Date.now() + ROTATION_REQUEST_TTL_MS);

    const rotationRequest = await this.prisma.shareRotationRequest.create({
      data:    { vaultId, requesterId, newPublicKey: dto.newPublicKey, expiresAt },
      include: {
        vault:     { select: { id: true, name: true, threshold: true, totalShares: true } },
        requester: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return {
      ...rotationRequest,
      holders: vault.shares
        .filter((s: any) => s.holderId !== requesterId)
        .map((s: any) => ({ holderId: s.holderId, holder: s.holder })),
    };
  }

  async getRotationRequest(rotationRequestId: string, vaultId: string, workspaceId: string) {
    await this.getVault(vaultId, workspaceId);

    const req = await this.prisma.shareRotationRequest.findUnique({
      where:   { id: rotationRequestId },
      include: {
        vault:       { select: { id: true, name: true, threshold: true, totalShares: true } },
        requester:   { select: { id: true, firstName: true, lastName: true } },
        submissions: { select: { holderId: true, submittedAt: true } },
      },
    });

    if (!req || req.vaultId !== vaultId) throw new NotFoundException('Rotation request not found');
    return req;
  }

  async listRotationRequests(vaultId: string, workspaceId: string) {
    await this.getVault(vaultId, workspaceId);

    return this.prisma.shareRotationRequest.findMany({
      where:   { vaultId, status: RotationRequestStatus.PENDING },
      include: {
        requester:   { select: { id: true, firstName: true, lastName: true } },
        submissions: { select: { holderId: true, submittedAt: true } },
        vault:       { select: { id: true, name: true, threshold: true, totalShares: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A holder submits their plaintext share to contribute to the rotation quorum.
   * The requester themselves is NOT allowed to submit (they have no valid private key).
   * Returns null while threshold not yet met; returns RotationQuorumPayload when ready.
   */
  async submitRotationShare(
    rotationRequestId: string,
    vaultId: string,
    workspaceId: string,
    holderId: string,
    dto: SubmitRotationShareDto,
  ): Promise<RotationQuorumPayload | null> {
    const vault = await this.getVault(vaultId, workspaceId);

    return this.prisma.$transaction(async tx => {
      const rotReq = await tx.shareRotationRequest.findUnique({
        where:   { id: rotationRequestId },
        include: { vault: true, submissions: true },
      });

      if (!rotReq || rotReq.vaultId !== vaultId)
        throw new NotFoundException('Rotation request not found');

      if (rotReq.status !== RotationRequestStatus.PENDING)
        throw new BadRequestException(`Rotation request is already ${rotReq.status.toLowerCase()}`);

      if (rotReq.expiresAt < new Date()) {
        await tx.shareRotationRequest.update({
          where: { id: rotationRequestId },
          data:  { status: RotationRequestStatus.EXPIRED },
        });
        throw new BadRequestException('Rotation request has expired');
      }

      // Requester cannot submit their own share for rotation (that's the whole point)
      if (holderId === rotReq.requesterId)
        throw new ForbiddenException('The requester cannot submit their own share for rotation');

      // Must be a holder for this vault
      const holderShare = await tx.vaultShare.findUnique({
        where: { vaultId_holderId: { vaultId, holderId } },
      });
      if (!holderShare) throw new ForbiddenException('You are not a key holder for this vault');

      await tx.rotationSubmission.upsert({
        where:  { rotationRequestId_holderId: { rotationRequestId, holderId } },
        create: { rotationRequestId, holderId, share: dto.share },
        update: { share: dto.share },
      });

      const allSubmissions = await tx.rotationSubmission.findMany({ where: { rotationRequestId } });
      // For rotation we need threshold submissions from OTHER holders
      const threshold = rotReq.vault.threshold;

      this.logger.log(
        `Vault ${vaultId} rotation request ${rotationRequestId}: ` +
        `${allSubmissions.length}/${threshold} shares`,
      );

      if (allSubmissions.length < threshold) return null;

      // Mark as APPROVED — finalization happens client-side then via PUT
      await tx.shareRotationRequest.update({
        where: { id: rotationRequestId },
        data:  { status: RotationRequestStatus.APPROVED },
      });

      // Collect shares with their indices
      const vaultShares   = await tx.vaultShare.findMany({
        where:  { vaultId, holderId: { in: allSubmissions.map(s => s.holderId) } },
        select: { holderId: true, shareIndex: true },
      });
      const indexByHolder = new Map(vaultShares.map(s => [s.holderId, s.shareIndex]));

      const sharesPayload = allSubmissions.map(s => ({
        holderId:   s.holderId,
        shareIndex: indexByHolder.get(s.holderId) ?? 1,
        share:      s.share,
      }));

      // Collect ALL holders' current public keys so the requester can re-encrypt for everyone
      const allVaultShares = await tx.vaultShare.findMany({
        where:  { vaultId },
        select: { holderId: true, holderPublicKey: true },
      });

      // For the requester's slot: use their NEW public key from the rotation request
      const holderPublicKeys = allVaultShares.map(s => ({
        holderId:  s.holderId,
        publicKey: s.holderId === rotReq.requesterId ? rotReq.newPublicKey : s.holderPublicKey,
      }));

      // Delete submissions — secret only lives in transit to requester
      await tx.rotationSubmission.deleteMany({ where: { rotationRequestId } });

      this.logger.log(
        `Vault ${vaultId}: rotation quorum reached, shares forwarded to userId=${rotReq.requesterId}`,
      );

      return {
        rotationRequestId,
        vaultId,
        requesterId:     rotReq.requesterId,
        shares:          sharesPayload,
        holderPublicKeys,
        threshold,
        totalShares:     vault.totalShares,
      };
    });
  }

  /**
   * After the requester has reconstructed the secret and re-split it with fresh keys,
   * they POST the new encrypted shares. We replace all VaultShare records atomically.
   */
  async finalizeRotation(
    rotationRequestId: string,
    vaultId: string,
    workspaceId: string,
    requesterId: string,
    dto: FinalizeRotationDto,
  ) {
    const vault = await this.getVault(vaultId, workspaceId);

    const rotReq = await this.prisma.shareRotationRequest.findUnique({
      where: { id: rotationRequestId },
    });

    if (!rotReq || rotReq.vaultId !== vaultId)
      throw new NotFoundException('Rotation request not found');

    // Only APPROVED (quorum met, waiting for finalize) or still PENDING accepted
    if (rotReq.status === RotationRequestStatus.EXPIRED)
      throw new BadRequestException('Rotation request has expired');
    if (rotReq.status === RotationRequestStatus.DENIED)
      throw new BadRequestException('Rotation request was denied');
    if (rotReq.requesterId !== requesterId)
      throw new ForbiddenException('Only the rotation requester can finalize');

    const { shares } = dto;

    if (shares.length !== vault.totalShares)
      throw new BadRequestException(
        `Expected ${vault.totalShares} shares but received ${shares.length}`,
      );

    const holderIds = shares.map(s => s.holderId);
    if (new Set(holderIds).size !== holderIds.length)
      throw new BadRequestException('Duplicate holder IDs');

    // All holder IDs must match the existing vault holders
    const existingHolderIds = new Set(vault.shares.map((s: any) => s.holderId));
    const invalidHolders    = holderIds.filter(id => !existingHolderIds.has(id));
    if (invalidHolders.length > 0)
      throw new BadRequestException(`Unknown holder IDs: ${invalidHolders.join(', ')}`);

    return this.prisma.$transaction(async tx => {
      // Replace all shares atomically
      for (const s of shares) {
        await tx.vaultShare.update({
          where: { vaultId_holderId: { vaultId, holderId: s.holderId } },
          data:  {
            encryptedShare:  s.encryptedShare,
            holderPublicKey: s.holderPublicKey,
            shareIndex:      s.shareIndex,
          },
        });
      }

      // Update requester's public key on their User record
      const myShare = shares.find(s => s.holderId === requesterId);
      if (myShare) {
        await tx.user.update({
          where: { id: requesterId },
          data:  { publicKey: myShare.holderPublicKey },
        });
      }

      // Close the rotation request
      await tx.shareRotationRequest.update({
        where: { id: rotationRequestId },
        data:  { status: RotationRequestStatus.APPROVED },
      });

      this.logger.log(
        `Vault ${vaultId}: rotation finalized by userId=${requesterId}. ` +
        `${shares.length} shares re-encrypted.`,
      );

      return this.findVaultById(vaultId, workspaceId, tx);
    });
  }

  async denyRotationRequest(
    rotationRequestId: string,
    vaultId: string,
    workspaceId: string,
    userId: string,
    role: Role,
  ) {
    await this.getVault(vaultId, workspaceId);

    const rotReq = await this.prisma.shareRotationRequest.findUnique({
      where: { id: rotationRequestId },
    });

    if (!rotReq || rotReq.vaultId !== vaultId)
      throw new NotFoundException('Rotation request not found');

    if (rotReq.status !== RotationRequestStatus.PENDING)
      throw new BadRequestException(`Request is already ${rotReq.status.toLowerCase()}`);

    const isPrivileged = role === Role.ADMIN || role === Role.OWNER;
    if (!isPrivileged && rotReq.requesterId !== userId)
      throw new ForbiddenException('You cannot deny this rotation request');

    return this.prisma.shareRotationRequest.update({
      where: { id: rotationRequestId },
      data:  { status: RotationRequestStatus.DENIED },
    });
  }

  // Background jobs

  async expireStaleRequests() {
    const now = new Date();

    const [accessCount, rotationCount] = await Promise.all([
      this.prisma.accessRequest.updateMany({
        where: { status: AccessRequestStatus.PENDING, expiresAt: { lt: now } },
        data:  { status: AccessRequestStatus.EXPIRED },
      }),
      this.prisma.shareRotationRequest.updateMany({
        where: { status: RotationRequestStatus.PENDING, expiresAt: { lt: now } },
        data:  { status: RotationRequestStatus.EXPIRED },
      }),
    ]);

    if (accessCount.count > 0)   this.logger.log(`Expired ${accessCount.count} stale access request(s)`);
    if (rotationCount.count > 0) this.logger.log(`Expired ${rotationCount.count} stale rotation request(s)`);
  }

  // Private Helpers

  private async findVaultById(vaultId: string, workspaceId: string, tx?: any) {
    const db    = tx ?? this.prisma;
    const vault = await db.vault.findUnique({
      where:   { id: vaultId },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        shares: {
          select: {
            id: true, shareIndex: true, holderId: true, holderPublicKey: true,
            holder: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { shareIndex: 'asc' },
        },
      },
    });

    if (!vault || vault.workspaceId !== workspaceId)
      throw new NotFoundException('Vault not found');

    return vault;
  }
}