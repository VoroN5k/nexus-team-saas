import { SetMetadata } from '@nestjs/common';
import { Role } from '../../../generated/prisma/client';

export const REQUIRE_ROLES_KEY = 'requiredRoles';
export const RequireRoles = (...roles: Role[]) => SetMetadata(REQUIRE_ROLES_KEY, roles);