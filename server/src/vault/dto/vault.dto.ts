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
  /** ID of the workspace member who holds this share */
  @IsUUID()
  holderId!: string;

  /**
   * Base64-encoded ciphertext:
   *   RSA-OAEP(holderPublicKey, sssShareHex)
   */
  @IsString()
  @IsNotEmpty()
  encryptedShare!: string;

  /**
   * Holder's SubjectPublicKeyInfo (SPKI) exported as base64.
   * Stored so the client can later verify encryption provenance.
   */
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

  /**
   * Minimum shares required to reconstruct the secret (k).
   * Must be ≤ totalShares (n).
   */
  @IsInt()
  @Min(2)
  @Max(20)
  threshold!: number;

  /**
   * Total number of shares distributed (n).
   * Must equal shares.length.
   */
  @IsInt()
  @Min(2)
  @Max(20)
  totalShares!: number;

  /** Encrypted share for each key holder — must have exactly totalShares entries */
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateShareDto)
  shares!: CreateShareDto[];
}

// Access Request

/** Initiate a quorum access request for a specific vault */
export class CreateAccessRequestDto {
  /**
   * Optional reason displayed to key holders in the WebSocket notification.
   * Helps them decide whether to approve.
   */
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