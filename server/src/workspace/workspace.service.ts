import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import {
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
  CreateInviteLinkDto,
  JoinWorkspaceDto,
} from './dto/workspace.dto';
import { Role } from '../../generated/prisma/client';

const INVITE_TTL_DEFAULT_H = 24;

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  // Workspace CRUD

  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    const slug = dto.slug.toLowerCase();
    const existing = await this.prisma.workspace.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Slug already in use');

    return this.prisma.$transaction(async (tx) => {
      return tx.workspace.create({
        data: {
          name: dto.name,
          slug,
          members: { create: { userId, role: Role.OWNER } },
        },
        include: { members: { where: { userId }, select: { role: true } } },
      });
    });
  }

  async getUserWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where:   { userId },
      include: {
        workspace: {
          select: {
            id: true, name: true, slug: true, createdAt: true,
            _count: { select: { members: true, tasks: true } },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map(({ workspace, role }) => ({ ...workspace, myRole: role }));
  }

  async getWorkspace(workspaceId: string) {
    const ws = await this.prisma.workspace.findUnique({
      where:   { id: workspaceId },
      include: { _count: { select: { members: true, tasks: true } } },
    });
    if (!ws) throw new NotFoundException('Workspace not found');
    return ws;
  }

  async updateWorkspace(workspaceId: string, dto: UpdateWorkspaceDto) {
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data:  { name: dto.name },
    });
  }

  async deleteWorkspace(workspaceId: string, requestingUserId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: requestingUserId, workspaceId } },
    });
    if (!membership || membership.role !== Role.OWNER) {
      throw new ForbiddenException('Only the workspace owner can delete it');
    }
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  // Members

  async getMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where:   { workspaceId },
      include: {
        user: {
          select: {
            id: true, email: true, firstName: true, lastName: true,
            // publicKey included so vault creator can encrypt shares for each holder
            publicKey: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async addMember(workspaceId: string, dto: InviteMemberDto) {
    const targetUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!targetUser) throw new NotFoundException('User not found');

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUser.id, workspaceId } },
    });
    if (existing) throw new ConflictException('User is already a member');

    return this.prisma.workspaceMember.create({
      data: { userId: targetUser.id, workspaceId, role: dto.role ?? Role.MEMBER },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, publicKey: true } },
      },
    });
  }

  async updateMemberRole(
    workspaceId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
    requestingUserId: string,
  ) {
    if (targetUserId === requestingUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const target = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === Role.OWNER) {
      throw new ForbiddenException("Cannot change the owner's role");
    }

    return this.prisma.workspaceMember.update({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      data:  { role: dto.role },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, publicKey: true } },
      },
    });
  }

  async removeMember(
    workspaceId: string,
    targetUserId: string,
    requestingUserId: string,
    requestingRole: Role,
  ) {
    if (targetUserId === requestingUserId) {
      if (requestingRole === Role.OWNER) {
        throw new BadRequestException('Owner cannot leave — transfer ownership or delete the workspace first');
      }
      await this.prisma.workspaceMember.delete({
        where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      });
      return;
    }

    const target = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === Role.OWNER) throw new ForbiddenException('Cannot remove the workspace owner');

    await this.prisma.workspaceMember.delete({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
  }

  // Invite Links

  /**
   * Generate a shareable workspace invite link.
   * Returns the raw token (shown once); only the SHA-256 hash is stored.
   */
  async createInviteLink(
    workspaceId: string,
    createdById: string,
    dto: CreateInviteLinkDto,
  ) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const ttlH     = dto.ttlHours ?? INVITE_TTL_DEFAULT_H;
    const expiresAt = new Date(Date.now() + ttlH * 60 * 60 * 1_000);

    await this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        createdById,
        tokenHash,
        maxUses:  dto.maxUses ?? null,
        expiresAt,
      },
    });

    return { token: rawToken, expiresAt };
  }

  /** Accept an invite link — adds the user as a MEMBER if the token is valid. */
  async joinViaInvite(userId: string, dto: JoinWorkspaceDto) {
    const tokenHash = crypto.createHash('sha256').update(dto.token).digest('hex');

    const invite = await this.prisma.workspaceInvite.findUnique({ where: { tokenHash } });

    if (!invite)                          throw new NotFoundException('Invite link not found');
    if (invite.expiresAt < new Date())    throw new GoneException('Invite link has expired');
    if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      throw new GoneException('Invite link has reached its maximum uses');
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: invite.workspaceId } },
    });
    if (existing) {
      // Already a member — silently redirect to workspace
      return this.prisma.workspace.findUniqueOrThrow({ where: { id: invite.workspaceId } });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.create({
        data: { userId, workspaceId: invite.workspaceId, role: Role.MEMBER },
      });
      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data:  { useCount: { increment: 1 } },
      });
      return tx.workspace.findUniqueOrThrow({ where: { id: invite.workspaceId } });
    });
  }

  /** List invite links for a workspace (metadata only — token hashes not exposed). */
  async listInviteLinks(workspaceId: string) {
    return this.prisma.workspaceInvite.findMany({
      where:   { workspaceId },
      select: {
        id: true, expiresAt: true, maxUses: true, useCount: true, createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInviteLink(inviteId: string, workspaceId: string) {
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.workspaceId !== workspaceId) {
      throw new NotFoundException('Invite not found');
    }
    await this.prisma.workspaceInvite.delete({ where: { id: inviteId } });
  }
}