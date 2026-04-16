import {
  Controller, Get, Post, Put, Delete, Body,
  Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultGateway } from './vault.gateway';
import {
  CreateVaultDto, CreateAccessRequestDto, SubmitShareDto,
  CreateRotationRequestDto, SubmitRotationShareDto, FinalizeRotationDto,
} from './dto/vault.dto';
import { JwtAuthGuard }         from 'src/auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from 'src/workspace/guards/workspace-member.guard';
import { RequireRoles }         from 'src/workspace/decorators/require-roles.decorator';
import { WorkspaceRole }        from 'src/workspace/decorators/workspace-role.decorator';
import { CurrentUser }          from 'src/auth/decorators/current-user.decorator';
import { JWTPayload }           from 'src/auth/interfaces/jwt-payload.interface';
import { Role }                 from 'src/prisma/prisma.types';

@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/vault')
export class VaultController {
  constructor(
    private readonly vaultService: VaultService,
    private readonly vaultGateway: VaultGateway,
  ) {}

  // Vault CRUD

  @RequireRoles(Role.ADMIN)
  @Post()
  createVault(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateVaultDto,
  ) {
    return this.vaultService.createVault(workspaceId, user.sub, dto);
  }

  @Get()
  listVaults(@Param('workspaceId') workspaceId: string) {
    return this.vaultService.listVaults(workspaceId);
  }

  @Get(':vaultId')
  getVault(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.vaultService.getVault(vaultId, workspaceId);
  }

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

  // Holder health check

  /**
   * Returns last-seen date for each holder so the owner can detect at-risk quorums
   * before they lose access to the vault permanently.
   */
  @Get(':vaultId/holder-health')
  getHolderHealth(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.vaultService.getHolderHealth(vaultId, workspaceId);
  }

  // My encrypted share

  @Get(':vaultId/my-share')
  getMyShare(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @CurrentUser() user: JWTPayload,
  ) {
    return this.vaultService.getMyEncryptedShare(vaultId, workspaceId, user.sub);
  }

  // Access Requests

  @Get(':vaultId/access-requests')
  listAccessRequests(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.vaultService.listAccessRequests(vaultId, workspaceId);
  }

  @Get(':vaultId/access-requests/:requestId')
  getAccessRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.vaultService.getAccessRequest(requestId, vaultId, workspaceId);
  }

  @Post(':vaultId/access-requests')
  async createAccessRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateAccessRequestDto,
  ) {
    const request = await this.vaultService.createAccessRequest(vaultId, workspaceId, user.sub, dto);

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { holders, ...publicRequest } = request;
    return publicRequest;
  }

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
    const result = await this.vaultService.submitShare(requestId, vaultId, workspaceId, user.sub, dto);

    if (result === null) {
      const request = await this.vaultService.getAccessRequest(requestId, vaultId, workspaceId);
      this.vaultGateway.notifyShareSubmitted({
        workspaceId,
        accessRequestId: requestId,
        vaultId,
        submittedByName: `${user.firstName} ${user.lastName}`,
        submittedCount:  request.submissions.length,
        threshold:       request.vault.threshold,
      });
      return { status: 'pending', submittedCount: request.submissions.length, threshold: request.vault.threshold };
    }

    this.vaultGateway.notifyQuorumReached({ ...result, workspaceId });
    return { status: 'approved', submittedCount: result.shares.length };
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':vaultId/access-requests/:requestId')
  async denyAccessRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: JWTPayload,
    @WorkspaceRole() role: Role,
  ) {
    await this.vaultService.denyAccessRequest(requestId, vaultId, workspaceId, user.sub, role);
    this.vaultGateway.notifyRequestDenied(workspaceId, requestId, vaultId);
  }

  // Key Rotation

  /** List pending rotation requests for this vault */
  @Get(':vaultId/rotation-requests')
  listRotationRequests(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
  ) {
    return this.vaultService.listRotationRequests(vaultId, workspaceId);
  }

  /**
   * A holder with a new/mismatched key pair requests rotation.
   * They supply their new public key — other holders will submit shares
   * so the requester can reconstruct the secret and re-encrypt everything.
   */
  @Post(':vaultId/rotation-requests')
  async createRotationRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateRotationRequestDto,
  ) {
    const request = await this.vaultService.createRotationRequest(vaultId, workspaceId, user.sub, dto);

    this.vaultGateway.notifyRotationRequested({
      workspaceId,
      rotationRequestId: request.id,
      vaultId:           request.vault.id,
      vaultName:         request.vault.name,
      requesterId:       user.sub,
      requesterName:     `${user.firstName} ${user.lastName}`,
      holderIds:         request.holders.map((h: any) => h.holderId),
      expiresAt:         request.expiresAt,
      threshold:         request.vault.threshold,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { holders, ...publicRequest } = request;
    return publicRequest;
  }

  /**
   * Another holder submits their plaintext share to contribute to the rotation quorum.
   * When threshold is reached, the server sends all shares to the requester via WebSocket
   * so they can reconstruct the secret and re-encrypt everything client-side.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':vaultId/rotation-requests/:rotationRequestId/submit')
  async submitRotationShare(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('rotationRequestId') rotationRequestId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: SubmitRotationShareDto,
  ) {
    const result = await this.vaultService.submitRotationShare(
      rotationRequestId, vaultId, workspaceId, user.sub, dto,
    );

    if (result === null) {
      const req = await this.vaultService.getRotationRequest(rotationRequestId, vaultId, workspaceId);
      this.vaultGateway.notifyRotationShareSubmitted({
        workspaceId,
        rotationRequestId,
        vaultId,
        submittedCount: req.submissions.length,
        threshold:      req.vault.threshold,
      });
      return { status: 'pending', submittedCount: req.submissions.length };
    }

    this.vaultGateway.notifyRotationQuorumReached({ ...result, workspaceId });
    return { status: 'quorum_reached' };
  }

  /**
   * After the requester has reconstructed the secret and re-split with fresh keys,
   * they PUT the new encrypted shares. The server replaces all VaultShare records atomically.
   */
  @Put(':vaultId/rotation-requests/:rotationRequestId/finalize')
  async finalizeRotation(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('rotationRequestId') rotationRequestId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: FinalizeRotationDto,
  ) {
    const vault = await this.vaultService.finalizeRotation(
      rotationRequestId, vaultId, workspaceId, user.sub, dto,
    );

    this.vaultGateway.notifyRotationFinalized(workspaceId, vaultId, user.sub);
    return vault;
  }

  /** Deny or cancel a rotation request */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':vaultId/rotation-requests/:rotationRequestId')
  async denyRotationRequest(
    @Param('workspaceId') workspaceId: string,
    @Param('vaultId') vaultId: string,
    @Param('rotationRequestId') rotationRequestId: string,
    @CurrentUser() user: JWTPayload,
    @WorkspaceRole() role: Role,
  ) {
    await this.vaultService.denyRotationRequest(rotationRequestId, vaultId, workspaceId, user.sub, role);
    this.vaultGateway.notifyRotationDenied(workspaceId, rotationRequestId, vaultId);
  }
}