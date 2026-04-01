import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from 'src/prisma/prisma.service';
import { Role } from '../../../generated/prisma';
import { REQUIRE_ROLES_KEY } from '../decorators/require-roles.decorator';

@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // Requires JwtAuthGuard to have run first
    const userId      = req.user?.sub as string;
    const workspaceId = req.params?.workspaceId as string;

    if (!userId || !workspaceId) return false;

    // Fetch membership
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
    });

    if (!member) {
      // Don't reveal whether workspace exists to non-members
      throw new NotFoundException('Workspace not found');
    }

    // Attach member context to request for downstream use
    req.workspaceMember = member;
    req.workspaceRole   = member.role;

    // Check if route requires specific roles
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(
      REQUIRE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const roleHierarchy: Record<Role, number> = {
      [Role.MEMBER]: 0,
      [Role.ADMIN]:  1,
      [Role.OWNER]:  2,
    };

    const userLevel    = roleHierarchy[member.role] ?? -1;
    const minRequired  = Math.min(...requiredRoles.map(r => roleHierarchy[r] ?? 99));

    if (userLevel < minRequired) {
      throw new ForbiddenException('Insufficient workspace permissions');
    }

    return true;
  }
}