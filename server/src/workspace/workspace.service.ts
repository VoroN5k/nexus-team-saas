import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto, UpdateMemberRoleDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { Role } from '../../generated/prisma/enums';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  // Workspace CRUD

  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    const slug = dto.slug.toLowerCase();

    const existing = await this.prisma.workspace.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Slug already in use');

    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: dto.name,
          slug,
          members: {
            create: { userId, role: Role.OWNER },
          },
        },
        include: { members: { where: { userId }, select: { role: true } } },
      });

      return workspace;
    });
  }

  /** Returns all workspaces the current user belongs to. */
  async getUserWorkspaces(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where:   { userId },
      include: {
        workspace: {
          select: {
            id:        true,
            name:      true,
            slug:      true,
            createdAt: true,
            _count:    { select: { members: true, tasks: true } },
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
      include: {
        _count: { select: { members: true, tasks: true } },
      },
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
    // Double-check OWNER (guard already verified, but defence in depth)
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
            id:        true,
            email:     true,
            firstName: true,
            lastName:  true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /**
   * Add or invite an existing user to the workspace.
   * In a real system this would send an invite email and await acceptance.
   * For now it directly creates the membership (useful for dev/demo).
   */
  async addMember(workspaceId: string, dto: InviteMemberDto) {
    const targetUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!targetUser) {
      // Don't reveal whether an email is registered — throw generic message
      throw new NotFoundException('User not found');
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUser.id, workspaceId } },
    });

    if (existing) throw new ConflictException('User is already a member');

    return this.prisma.workspaceMember.create({
      data: {
        userId:      targetUser.id,
        workspaceId,
        role:        dto.role ?? Role.MEMBER,
      },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }

  async updateMemberRole(
    workspaceId:     string,
    targetUserId:    string,
    dto:             UpdateMemberRoleDto,
    requestingUserId: string,
  ) {
    // Cannot change your own role
    if (targetUserId === requestingUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const target = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });

    if (!target) throw new NotFoundException('Member not found');

    // OWNER cannot be demoted via this endpoint
    if (target.role === Role.OWNER) {
      throw new ForbiddenException('Cannot change the owner\'s role — transfer ownership first');
    }

    return this.prisma.workspaceMember.update({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
      data:  { role: dto.role },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
  }

  async removeMember(
    workspaceId:      string,
    targetUserId:     string,
    requestingUserId: string,
    requestingRole:   Role,
  ) {
    // Allow self-removal (leave workspace) unless you're the owner
    if (targetUserId === requestingUserId) {
      if (requestingRole === Role.OWNER) {
        throw new BadRequestException(
          'Owner cannot leave — transfer ownership or delete the workspace first',
        );
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

    if (target.role === Role.OWNER) {
      throw new ForbiddenException('Cannot remove the workspace owner');
    }

    await this.prisma.workspaceMember.delete({
      where: { userId_workspaceId: { userId: targetUserId, workspaceId } },
    });
  }
}