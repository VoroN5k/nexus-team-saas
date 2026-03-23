import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import { SessionMeta } from './interfaces/session-meta.interface';
import * as bcrypt from 'bcrypt';
import { generateToken, hashToken } from './utils/token.util';
import { EmailService } from './email/email.service';
import { LoginDto } from './dto/login.dto';
import { text } from 'stream/consumers';
import { JWTPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly MAX_SESSIONS = 5;
    private readonly REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
    private readonly RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly emailService: EmailService,
    ) {}

    async register(dto: RegisterDto, meta: SessionMeta) {
        const { email, password, confirmPassword, firstName, lastName } = dto;

        if (password !== confirmPassword) throw new BadRequestException("Passwords do not match");

        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.user.findFirst({
                where: {
                    OR: [
                        { email },
                        { firstName, lastName }
                    ]
                }
            })

            if (existing) throw new ConflictException("Email or username already in use");

            const hashedPassword = await bcrypt.hash(password, 10);
            const verifyToken = generateToken();

            const user = await tx.user.create({
                data: {
                    email,
                    firstName,
                    lastName,
                    password: hashedPassword,
                    emailVerifyToken: hashToken(verifyToken),
                
                },
            });

            await this.emailService.sendVerificationEmail(email, verifyToken);

            return this.issueTokens(user.id, meta, tx);
        })
    }

    async login(dto: LoginDto, meta: SessionMeta) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email }
        });

        if (!user || !(await bcrypt.cmpare(dto.password, user.password))) {
            throw new UnauthorizedException("Invalid credentials");
        }

        if (!user.isEmailVerified) {
            throw new UnauthorizedException("Email not verified");
        }

        return this.issueTokens(user.id, meta, this.prisma);
    }

    async refresh(rawRefreshToken: string, meta: SessionMeta) {
        const hashed = hashToken(rawRefreshToken);
        return this.prisma.$transaction(async (tx) => {
            const session = await tx.session.findUnique({
                where: { refreshToken: hashed },
                include: { user: true } 
            });

            if(!session) {
                this.logger.warn(
                `Refresh token not found - possible reuse attack (hashed: ${hashed.slice(0, 12)}...)`
                );
                throw new UnauthorizedException("Invalid or expired refresh token");
            }

            if (session.expiresAt < new Date()) {
                await tx.session.delete({ where: { id: session.id } });
                throw new UnauthorizedException("Refresh token expired, please log in again");
             }

            return this.rotateSession(session.id, session.userId, meta, tx);
        });
    }

    async verifyEmail(token: string) {

    }

    async getUserSessions(userId: string) {
        return this.prisma.session.findMany({
            where: { userId },
            select: {
                id: true, userAgent: true, ipAddress: true,
                createdAt: true, expiresAt: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    private async issueTokens(userId: string, meta: SessionMeta, tx?: any) {
        const client = tx || this.prisma;
        const userAgent = meta.userAgent || "Unknown";

        const existing = await client.session.findFirst({
            where: { userId, userAgent },
        });

        if (existing) {
            return this.rotateSession(existing.id, userId, meta, client);
        }
        
        const activeSessions = await client.session.findMany({
            where:   { userId },
            orderBy: { createdAt: 'asc' },
        });

        if (activeSessions.length >= this.MAX_SESSIONS) {
            await client.session.delete({ where: { id: activeSessions[0].id } });
        }

        const { accessToken, rawRefreshToken } = await this.generateTokens(userId, client);

        await client.session.create({
            data: {
                userId,
                refreshToken: hashToken(rawRefreshToken),
                userAgent,
                ipAddress: meta.ip || 'unknown',
                expiresAt: new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY_MS),
            },
        });

        return { accessToken, refreshToken: rawRefreshToken };
    }

    private async rotateSession(
        sessionId: string,
        userId:    string,
        meta:      SessionMeta,
        client:    any,
    ) {
        const { accessToken, rawRefreshToken } = await this.generateTokens(userId, client);

        await client.session.update({
            where: { id: sessionId },
            data: {
                refreshToken: hashToken(rawRefreshToken),
                ipAddress:    meta.ip || 'unknown',
                expiresAt:    new Date(Date.now() + this.REFRESH_TOKEN_EXPIRY_MS),
            },
        });

        return { accessToken, refreshToken: rawRefreshToken };
    }

    /**
     * Генерує:
     *   - accessToken: підписаний JWT з payload користувача
     *   - rawRefreshToken: криптографічно випадковий hex-рядок
     */
    private async generateTokens(userId: string, client?: any) {
        const db   = client || this.prisma;
        const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

        const payload: JWTPayload = {
            sub:      user.id,
            email:    user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role:     user.role,
        };

        return {
            accessToken:     this.jwtService.sign(payload, { expiresIn: '15m' }),
            rawRefreshToken: generateToken(),
        };
    }
}

// Utility
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

