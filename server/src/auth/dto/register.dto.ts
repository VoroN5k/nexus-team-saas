import { IsEmail, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(6)
    @MaxLength(32)
    password: string;

    @IsString()
    @MinLength(6)
    @MaxLength(32)
    confirmPassword: string;

    @IsString()
    @MinLength(3)
    @MaxLength(20)
    firstName: string;

    @IsString()
    @MinLength(3)
    @MaxLength(20)
    lastName: string;

    @IsOptional()
    @IsObject()
    meta?: {
        userAgent?: string;
        ip?: string;
    }
}