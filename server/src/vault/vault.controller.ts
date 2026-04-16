import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultGateway } from './vault.gateway';
import {
  CreateVaultDto,
  CreateAccessRequestDto,
  SubmitShareDto,
} from './dto/vault.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from 'src/workspace/guards/workspace-member.guard';
import { RequireRoles } from 'src/workspace/decorators/require-roles.decorator';
import { WorkspaceRole } from 'src/workspace/decorators/workspace-role.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JWTPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { Role } from 'src/prisma/prisma.types';

/**
 * Routes: /workspaces/:workspaceId/vault/*
 *
 * All routes require:
 *   1. Valid JWT (JwtAuthGuard)
 *   2. Membership in the workspace (WorkspaceMemberGuard)
 */
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/vault')
export class VaultController {
  constructor(
    private readonly vaultService: VaultService,
    private readonly vaultGateway: VaultGateway,
  ) {}

  // Vault CRUD

  /**
   * Create a new zero-knowledge vault entry.
   * Only ADMIN and OWNER can create vaults.
   * The request body includes encrypted SSS shares — the raw secret is never sent.
   */
  @RequireRoles(Role.ADMIN)
  @Post()
  async createVault(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateVaultDto,
  ) {
    return this.vaultService.createVault(workspaceId, user.sub, dto);
  }

  /** List vault metadata for the workspace (no share content returned). */
  @Get()
  listVaults(@Param('workspaceId') workspaceId: string) {
    return this.vaultService.listVaults(workspaceId);
  }

  /** Get a single vault with its holders (no encrypted share content). */
  @Get(':vaultId')
  getVault(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.vaultService.getVault(vaultId, workspaceId);
  }

  /** Delete a vault — ADMIN or OWNER only. */
  @RequireRoles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':vaultId')
  deleteVault(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @WorkspaceRole() role: Role,
  ) {
    return this.vaultService.deleteVault(vaultId, workspaceId, role);
  }

  // Encrypted Share 
  /**
   * A key holder fetches their own encrypted SSS share.
   * They decrypt it client-side using their private key, then use the
   * plaintext share to fulfil an access request.
   */
  @Get(':vaultId/my-share')
  getMyShare(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @CurrentUser() user: JWTPayload,
  ) {
    return this.vaultService.getMyEncryptedShare(vaultId, workspaceId, user.sub);
  }

  // Access Requests

  /** List all access requests for a vault (most recent first). */
  @Get(':vaultId/access-requests')
  listAccessRequests(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.vaultService.listAccessRequests(vaultId, workspaceId);
  }

  /** Get a specific access request with its submission progress. */
  @Get(':vaultId/access-requests/:requestId')
  getAccessRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.vaultService.getAccessRequest(requestId, vaultId, workspaceId);
  }

  /**
   * Create a new access request to unlock a vault.
   *
   * Side-effects:
   *   1. Persists AccessRequest record.
   *   2. Emits `vault:access_requested` to all workspace members over WebSocket
   *      so key holders can see and respond to the notification in real time.
   */
  @Post(':vaultId/access-requests')
  async createAccessRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateAccessRequestDto,
  ) {
    const request = await this.vaultService.createAccessRequest(
      vaultId, workspaceId, user.sub, dto,
    );

    // Notify all connected workspace members via WebSocket
    this.vaultGateway.notifyAccessRequested({
      workspaceId,
      accessRequestId: request.id,
      vaultId:         request.vault.id,
      vaultName:       request.vault.name,
      requesterId:     user.sub,
      requesterName:   `${user.firstName} ${user.lastName}`,
      reason:          request.reason,
      holderIds:       request.holders.map((h: any) => h.holderId),
      expiresAt:       request.expiresAt,
      threshold:       request.vault.threshold,
      totalShares:     request.vault.totalShares,
    });

    // Strip holders' detailed info before returning to client
    const { holders, ...publicRequest } = request;
    return publicRequest;
  }

  /**
   * A key holder submits their decrypted SSS share for an access request.
   *
   * The plaintext share is stored ephemerally.  The moment the quorum threshold
   * is reached the service:
   *   a) marks the request as APPROVED
   *   b) collects all plaintext shares
   *   c) deletes them from the DB
   *
   * Then this controller emits the shares to the requester's private
   * WebSocket room — they never persist beyond that emit.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':vaultId/access-requests/:requestId/submit')
  async submitShare(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: JWTPayload,
    @WorkspaceRole() role: Role,
    @Body() dto: SubmitShareDto,
  ) {
    const result = await this.vaultService.submitShare(
      requestId, vaultId, workspaceId, user.sub, dto,
    );

    if (result === null) {
      // Threshold not yet met — emit progress update
      const request = await this.vaultService.getAccessRequest(requestId, vaultId, workspaceId);

      this.vaultGateway.notifyShareSubmitted({
        workspaceId,
        accessRequestId: requestId,
        vaultId,
        submittedByName: `${user.firstName} ${user.lastName}`,
        submittedCount:  request.submissions.length,
        threshold:       request.vault.threshold,
      });

      return {
        status:         'pending',
        submittedCount: request.submissions.length,
        threshold:      request.vault.threshold,
      };
    }

    // Quorum reached: forward shares to requester via private WS room
    this.vaultGateway.notifyQuorumReached({ ...result, workspaceId });

    return {
      status:         'approved',
      submittedCount: result.shares.length,
    };
  }

  /**
   * Deny or cancel a pending access request.
   * The original requester or an ADMIN/OWNER can cancel.
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':vaultId/access-requests/:requestId')
  async denyAccessRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: JWTPayload,
    @WorkspaceRole() role: Role,
  ) {
    await this.vaultService.denyAccessRequest(
      requestId, vaultId, workspaceId, user.sub, role,
    );

    this.vaultGateway.notifyRequestDenied(workspaceId, requestId, vaultId);
  }
}