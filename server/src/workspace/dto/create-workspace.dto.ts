import { IsString, IsNotEmpty, MinLength, MaxLength, Matches } from "class-validator";

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(50)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, { message: 'Slug can only contain lowercase letters, numbers, and hyphens' })
  slug!: string;
}