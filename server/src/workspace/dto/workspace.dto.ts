import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Role } from '../../../generated/prisma/client';

export class UpdateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  name!: string;
}

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class UpdateMemberRoleDto {
  @IsEnum(Role)
  role!: Role;
}

export class CreateInviteLinkDto {
  /** How many hours the link stays valid (1–168, default 24) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  ttlHours?: number;

  /** Max number of uses (null = unlimited) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxUses?: number;
}

export class JoinWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}