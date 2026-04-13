import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';

export const WorkspaceRole = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Role => {
    const request = ctx.switchToHttp().getRequest();
    return request.workspaceRole as Role;
  },
);