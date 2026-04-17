import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class OpaqueRegisterInitDto {
  /** User's email - used as the OPAQUE userIdentifier (must be stable, never changes) */
  @IsEmail()
  userIdentifier!: string;

  /** OPRF request from the client (opaque binary, base64-encoded by library) */
  @IsString()
  @IsNotEmpty()
  registrationRequest!: string;
}

export class OpaqueRegisterFinishDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  registrationRecord!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(20)
  firstName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(20)
  lastName!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(50)
  organizationName!: string;
}

// Login

export class OpaqueLoginInitDto {
  @IsEmail()
  userIdentifier!: string;

  @IsString()
  @IsNotEmpty()
  startLoginRequest!: string;
}

export class OpaqueLoginFinishDto {
  @IsEmail()
  userIdentifier!: string;

  /** The random nonce returned by /login-init, ties the two round-trips together */
  @IsString()
  @IsNotEmpty()
  nonce!: string;

  @IsString()
  @IsNotEmpty()
  finishLoginRequest!: string;
}
