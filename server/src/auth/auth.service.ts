import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailService } from './email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OpaqueRegisterFinishDto } from './dto/opaque.dto';
import { SessionMeta } from './interfaces/session-meta.interface';
import { JWTPayload } from './interfaces/jwt-payload.interface';
import { generateToken, hashToken } from './utils/token.util';
import * as argon2 from 'argon2';
import { Role } from '../../generated/prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly MAX_SESSIONS        = 5;
  private readonly REFRESH_TTL_MS      = 7 * 24 * 60 * 60 * 1_000;
  private readonly VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;

  private readonly ARGON2_OPTIONS = {
    type:        argon2.argon2id,
    memoryCost:  65_536,
    timeCost:    3,
    parallelism: 4,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt:    JwtService,
    private readonly email:  EmailService,
  ) {}

  // OPAQUE auth

  /**
   * Looks up a user by email for OPAQUE login.
   * Returns the user with their opaqueRecord so the controller can call OpaqueService.loginInit.
   * Returns null if no user found (caller must return generic error to prevent user enumeration).
   */
  async findUserForOpaque(email: string) {
    return this.prisma.user.findUnique({
      where:  { email },
      select: { id: true, opaqueRecord: true },
    });
  }

  /**
   * OPAQUE Registration - called AFTER the OpaqueService has completed the key exchange.
   * Creates a new user; stores the OPAQUE registrationRecord (not the password).
   */
  async opaqueRegister(dto: OpaqueRegisterFinishDto, meta: SessionMeta) {
    const { email, registrationRecord, firstName, lastName, organizationName } = dto;

    return this.prisma.$transaction(async tx => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new ConflictException('Email already in use');

      const rawVerifyToken = generateToken();

      const user = await tx.user.create({
        data: {
          email,
          firstName,
          lastName,
          // No password stored - OPAQUE replaces it
          password:         '', // field still in schema for legacy compat; never used for OPAQUE users
          opaqueRecord:     registrationRecord,
          emailVerifyToken: hashToken(rawVerifyToken),
          lastSeenAt:       new Date(),
        },
      });

      const slug      = this.slugify(organizationName);
      const safeSlug  = await this.ensureUniqueSlug(slug, tx);

      const workspace = await tx.workspace.create({
        data: {
          name:    organizationName,
          slug:    safeSlug,
          members: { create: { userId: user.id, role: Role.OWNER } },
        },
      });

      this.email
        .sendVerificationEmail(email, rawVerifyToken)
        .catch(err => this.logger.warn(`Verification email failed for ${email}: ${err?.message}`));

      const tokens = await this.issueTokens(user.id, meta, tx);
      return { ...tokens, workspaceSlug: workspace.slug };
    });
  }

  /**
   * OPAQUE Login - called AFTER OpaqueService.loginFinish has verified the MAC.
   * At this point authentication is already proven; we just issue JWTs.
   */
  async opaqueLogin(email: string, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    // Touch lastSeenAt
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastSeenAt: new Date() },
    });

    return this.issueTokens(user.id, meta, this.prisma);
  }

  // Legacy password auth

  async register(dto: RegisterDto, meta: SessionMeta) {
    const { email, password, confirmPassword, firstName, lastName, organizationName } = dto;

    if (password !== confirmPassword)
      throw new BadRequestException('Passwords do not match');

    return this.prisma.$transaction(async tx => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) throw new ConflictException('Email already in use');

      const hashedPassword  = await argon2.hash(password, this.ARGON2_OPTIONS);
      const rawVerifyToken  = generateToken();

      const user = await tx.user.create({
        data: {
          email, firstName, lastName,
          password:         hashedPassword,
          emailVerifyToken: hashToken(rawVerifyToken),
          lastSeenAt:       new Date(),
        },
      });

      const slug     = this.slugify(organizationName);
      const safeSlug = await this.ensureUniqueSlug(slug, tx);

      const workspace = await tx.workspace.create({
        data: {
          name:    organizationName,
          slug:    safeSlug,
          members: { create: { userId: user.id, role: Role.OWNER } },
        },
      });

      this.email
        .sendVerificationEmail(email, rawVerifyToken)
        .catch(err => this.logger.warn(`Failed to send verification email to ${email}: ${err?.message}`));

      const tokens = await this.issueTokens(user.id, meta, tx);
      return { ...tokens, workspaceSlug: workspace.slug };
    });
  }

  async login(dto: LoginDto, meta: SessionMeta) {
    const user          = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const passwordValid = user !== null && !!user.password && (await argon2.verify(user.password, dto.password));

    if (!user || !passwordValid) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastSeenAt: new Date() },
    });

    return this.issueTokens(user.id, meta, this.prisma);
  }

  // Token management

  async refresh(rawRefreshToken: string, meta: SessionMeta) {
    const hashed = hashToken(rawRefreshToken);

    return this.prisma.$transaction(async tx => {
      const session = await tx.session.findUnique({
        where:   { refreshToken: hashed },
        include: { user: true },
      });

      if (!session) {
        this.logger.warn(`Refresh token not found — possible reuse (prefix: ${hashed.slice(0, 12)}...)`);
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      if (session.expiresAt < new Date()) {
        await tx.session.delete({ where: { id: session.id } });
        throw new UnauthorizedException('Session expired, please log in again');
      }

      await tx.user.update({ where: { id: session.userId }, data: { lastSeenAt: new Date() } });
      return this.rotateSession(session.id, session.userId, meta, tx);
    });
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const hashed = hashToken(rawRefreshToken);
    await this.prisma.session.delete({ where: { refreshToken: hashed } }).catch(() => null);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  async verifyEmail(rawToken: string): Promise<{ message: string }> {
    if (!rawToken) throw new BadRequestException('Token is required');
    const hashed = hashToken(rawToken);
    const user   = await this.prisma.user.findFirst({ where: { emailVerifyToken: hashed } });
    if (!user) throw new NotFoundException('Invalid or expired verification token');
    if (user.isEmailVerified) return { message: 'Email already verified' };
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { isEmailVerified: true, emailVerifyToken: null },
    });
    return { message: 'Email verified successfully' };
  }

  async getUserSessions(userId: string) {
    return this.prisma.session.findMany({
      where:   { userId },
      select:  { id: true, deviceName: true, userAgent: true, ipAddress: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('Session not found');
    await this.prisma.session.delete({ where: { id: sessionId } });
  }

  async publishPublicKey(userId: string, publicKey: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { publicKey } });
  }

  // Private helpers

  private async issueTokens(userId: string, meta: SessionMeta, tx: any) {
    const userAgent = meta.userAgent || 'Unknown';

    const existing = await tx.session.findFirst({ where: { userId, userAgent } });
    if (existing) return this.rotateSession(existing.id, userId, meta, tx);

    const activeSessions = await tx.session.findMany({
      where:   { userId },
      orderBy: { createdAt: 'asc' },
    });

    if (activeSessions.length >= this.MAX_SESSIONS) {
      await tx.session.delete({ where: { id: activeSessions[0].id } });
    }

    const { accessToken, rawRefreshToken } = await this.generateTokens(userId, tx);

    await tx.session.create({
      data: {
        userId,
        refreshToken: hashToken(rawRefreshToken),
        userAgent,
        ipAddress:    meta.ip ?? 'unknown',
        expiresAt:    new Date(Date.now() + this.REFRESH_TTL_MS),
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private async rotateSession(sessionId: string, userId: string, meta: SessionMeta, tx: any) {
    const { accessToken, rawRefreshToken } = await this.generateTokens(userId, tx);
    await tx.session.update({
      where: { id: sessionId },
      data:  {
        refreshToken: hashToken(rawRefreshToken),
        ipAddress:    meta.ip ?? 'unknown',
        expiresAt:    new Date(Date.now() + this.REFRESH_TTL_MS),
      },
    });
    return { accessToken, refreshToken: rawRefreshToken };
  }

  private async generateTokens(userId: string, tx?: any) {
    const db   = tx ?? this.prisma;
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });

    const payload: JWTPayload = {
      sub:       user.id,
      email:     user.email,
      firstName: user.firstName,
      lastName:  user.lastName,
    };

    return {
      accessToken:     this.jwt.sign(payload, { expiresIn: '15m' }),
      rawRefreshToken: generateToken(),
    };
  }

  private slugify(name: string): string {
    return name.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
  }

  private async ensureUniqueSlug(base: string, tx: any): Promise<string> {
    let slug = base, attempt = 0;
    while (await tx.workspace.findUnique({ where: { slug } })) slug = `${base}-${++attempt}`;
    return slug;
  }
}