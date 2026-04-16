import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
  ArrayMinSize,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

// Share DTOs

export class CreateShareDto {
  @IsUUID()
  holderId!: string;

  @IsString()
  @IsNotEmpty()
  encryptedShare!: string;

  @IsString()
  @IsNotEmpty()
  holderPublicKey!: string;

  @IsInt()
  @Min(1)
  shareIndex!: number;
}

// Vault CRUD

export class CreateVaultDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsInt()
  @Min(2)
  @Max(20)
  threshold!: number;

  @IsInt()
  @Min(2)
  @Max(20)
  totalShares!: number;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateShareDto)
  shares!: CreateShareDto[];
}

// Access Request

export class CreateAccessRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class SubmitShareDto {
  @IsString()
  @IsNotEmpty()
  share!: string;
}

// Key Rotation

/** Holder initiates rotation: I have a new key pair, please help me re-encrypt my share */
export class CreateRotationRequestDto {
  /** The requester's NEW RSA-OAEP public key (base64 SPKI) */
  @IsString()
  @IsNotEmpty()
  newPublicKey!: string;
}

/** Another holder submits their plaintext share to help reach rotation quorum */
export class SubmitRotationShareDto {
  @IsString()
  @IsNotEmpty()
  share!: string;
}

/** After quorum, requester sends back all re-encrypted shares */
export class FinalizeRotationDto {
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateShareDto)
  shares!: CreateShareDto[];
}