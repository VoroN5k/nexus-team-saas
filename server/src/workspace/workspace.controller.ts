import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import {
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
  CreateInviteLinkDto,
  JoinWorkspaceDto,
} from './dto/workspace.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from './guards/workspace-member.guard';
import { RequireRoles } from './decorators/require-roles.decorator';
import { WorkspaceRole } from './decorators/workspace-role.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JWTPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { Role } from '../prisma/prisma.types';

@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  // Workspace CRUD

  @Post()
  create(@CurrentUser() user: JWTPayload, @Body() dto: CreateWorkspaceDto) {
    return this.workspaceService.createWorkspace(user.sub, dto);
  }

  @Get()
  findMine(@CurrentUser() user: JWTPayload) {
    return this.workspaceService.getUserWorkspaces(user.sub);
  }

  /** Join a workspace via a shared invite token (no WorkspaceMemberGuard needed). */
  @HttpCode(HttpStatus.OK)
  @Post('join')
  joinViaInvite(@CurrentUser() user: JWTPayload, @Body() dto: JoinWorkspaceDto) {
    return this.workspaceService.joinViaInvite(user.sub, dto);
  }

  @UseGuards(WorkspaceMemberGuard)
  @Get(':workspaceId')
  findOne(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.getWorkspace(workspaceId);
  }

  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @Patch(':workspaceId')
  update(@Param('workspaceId') workspaceId: string, @Body() dto: UpdateWorkspaceDto) {
    return this.workspaceService.updateWorkspace(workspaceId, dto);
  }

  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':workspaceId')
  remove(@Param('workspaceId') workspaceId: string, @CurrentUser() user: JWTPayload) {
    return this.workspaceService.deleteWorkspace(workspaceId, user.sub);
  }

  // Members

  @UseGuards(WorkspaceMemberGuard)
  @Get(':workspaceId/members')
  getMembers(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.getMembers(workspaceId);
  }

  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @Post(':workspaceId/members')
  addMember(@Param('workspaceId') workspaceId: string, @Body() dto: InviteMemberDto) {
    return this.workspaceService.addMember(workspaceId, dto);
  }

  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.OWNER)
  @Patch(':workspaceId/members/:userId')
  updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: JWTPayload,
  ) {
    return this.workspaceService.updateMemberRole(workspaceId, targetUserId, dto, user.sub);
  }

  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':workspaceId/members/:userId')
  removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: JWTPayload,
    @WorkspaceRole() role: Role,
  ) {
    return this.workspaceService.removeMember(workspaceId, targetUserId, user.sub, role);
  }

  // Invite Links

  /** Generate a new shareable invite link (ADMIN+). Token returned once only. */
  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @Post(':workspaceId/invites')
  createInviteLink(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateInviteLinkDto,
  ) {
    return this.workspaceService.createInviteLink(workspaceId, user.sub, dto);
  }

  /** List active invite links for this workspace. */
  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @Get(':workspaceId/invites')
  listInviteLinks(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.listInviteLinks(workspaceId);
  }

  /** Revoke an invite link. */
  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':workspaceId/invites/:inviteId')
  revokeInviteLink(
    @Param('workspaceId') workspaceId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.workspaceService.revokeInviteLink(inviteId, workspaceId);
  }
}