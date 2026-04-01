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
import { InviteMemberDto, UpdateMemberRoleDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from './guards/workspace-member.guard';
import { RequireRoles } from './decorators/require-roles.decorator';
import { WorkspaceRole } from './decorators/workspace-role.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JWTPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { Role } from '../../generated/prisma';

@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  // Workspace CRUD

  /** Create a new workspace (any authenticated user). */
  @Post()
  create(
    @CurrentUser() user: JWTPayload,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspaceService.createWorkspace(user.sub, dto);
  }

  /** List all workspaces the current user belongs to. */
  @Get()
  findMine(@CurrentUser() user: JWTPayload) {
    return this.workspaceService.getUserWorkspaces(user.sub);
  }

  /** Get workspace details (members only). */
  @UseGuards(WorkspaceMemberGuard)
  @Get(':workspaceId')
  findOne(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.getWorkspace(workspaceId);
  }

  /** Update workspace name (ADMIN or OWNER). */
  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @Patch(':workspaceId')
  update(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaceService.updateWorkspace(workspaceId, dto);
  }

  /** Delete workspace — OWNER only. */
  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':workspaceId')
  remove(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: JWTPayload,
  ) {
    return this.workspaceService.deleteWorkspace(workspaceId, user.sub);
  }

  // Members 

  /** List workspace members */
  @UseGuards(WorkspaceMemberGuard)
  @Get(':workspaceId/members')
  getMembers(@Param('workspaceId') workspaceId: string) {
    return this.workspaceService.getMembers(workspaceId);
  }

  /** Add/invite a member by email — ADMIN or OWNER. */
  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.ADMIN)
  @Post(':workspaceId/members')
  addMember(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspaceService.addMember(workspaceId, dto);
  }

  /** Change a member's role — OWNER only (prevents ADMIN elevating others). */
  @UseGuards(WorkspaceMemberGuard)
  @RequireRoles(Role.OWNER)
  @Patch(':workspaceId/members/:userId')
  updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
    @CurrentUser() user: JWTPayload,
  ) {
    return this.workspaceService.updateMemberRole(
      workspaceId,
      targetUserId,
      dto,
      user.sub,
    );
  }

  /** Remove a member or leave the workspace (self-removal). */
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
}