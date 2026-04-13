import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Role } from "../../../generated/prisma/client";

export class UpdateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  name: string;
}

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class UpdateMemberRoleDto {
  @IsEnum(Role)
  role: Role;
}