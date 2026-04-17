import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  Res,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Put,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { JWTPayload } from './interfaces/jwt-payload.interface';
import { OpaqueService } from 'src/auth/opaque/opaque.service';
import {
  OpaqueLoginFinishDto,
  OpaqueLoginInitDto,
  OpaqueRegisterFinishDto,
  OpaqueRegisterInitDto,
} from 'src/auth/dto/opaque.dto';
import * as crypto from 'crypto';

// Cookie config helper
const refreshCookieOptions = (isProd: boolean) => ({
  httpOnly:  true,                          // Not accessible via JS (XSS mitigation)
  secure:    isProd,                        // HTTPS only in production
  sameSite:  'lax'  as const,              // CSRF mitigation — blocks cross-site POSTs
  path:      '/api/auth',                  // Scoped: only sent to /api/auth/* endpoints
  maxAge:    7 * 24 * 60 * 60 * 1_000,    // 7 days
});

@Controller('auth')
export class AuthController {
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(
    private readonly authService: AuthService,
    private readonly opaqueService: OpaqueService,
  ) {}

  // OPAQUE Registration ( 2 round-trips )

  /**
   * Round 1: Client sends OPRF request, server responds with OPRF evaluation
   * No user record is created yet - this is just cryptographic key exchange
   */

  // Strict rate limit: 10 registrations per 15 minutes per IP
  @Throttle({ default: { ttl: 900_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('opaque/register-init')
  opaqueRegisterInit(@Body() dto: OpaqueRegisterInitDto) {
    const registrationResponse = this.opaqueService.registrationResponse(
      dto.userIdentifier,
      dto.registrationRequest,
    );
    return { registrationResponse };
  }

  /**
   * Round 2: Client sends the completed registrationRecord (the OPAQUE envelope)
   * Server creates the user account. Password is NEVER transmitted or stored
   */

  @Throttle({ default: { ttl: 900_000, limit: 5 } })
  @Post('opaque/register-finish')
  async opaqueRegisterFinish(
    @Body() dto: OpaqueRegisterFinishDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta   = this.extractMeta(req);
    const result = await this.authService.opaqueRegister(dto, meta);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, workspaceSlug: result.workspaceSlug };
  }

  // ── OPAQUE Login (2 round-trips) ─────────────────────────────────────────

  /**
   * Round 1: Client sends OPRF login request
   * Server responds with its half of the AKE handshake
   * A short-lived `nonce` ties the two round-trips together (replay protection)
   */

  // Strict rate limit: 20 attempts per 15 minutes per IP
  @Throttle({ default: { ttl: 900_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @Post('opaque/login-init')
  async opaqueLoginInit(@Body() dto: OpaqueLoginInitDto) {
    const user = await this.authService.findUserForOpaque(dto.userIdentifier);

    if (!user?.opaqueRecord) {
      // Blind error - don't reveal whether the account exists or has OPAQUE configured
      throw new UnauthorizedException('Invalid credentials');
    }

    // Random nonce ties the two round-trips; client echoes it back in login-finish
    const nonce = crypto.randomBytes(16).toString('hex');

    const loginResponse = this.opaqueService.loginInit(
      dto.userIdentifier,
      user.opaqueRecord,
      dto.startLoginRequest,
      nonce,
    );

    return { loginResponse, nonce };
  }

  /**
   * Round 2: Client sends the AKE finish message
   * Server verifies the MAC (proves the client knows the password without seeing it)
   * On success, issues JWT + refresh token
   */
  @Throttle({ default: { ttl: 900_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @Post('opaque/login-finish')
  async opaqueLoginFinish(
    @Body() dto: OpaqueLoginFinishDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Will throw UnauthorizedException if MAC fails
    try {
      this.opaqueService.loginFinish(dto.nonce, dto.finishLoginRequest);
    } catch {
      throw new UnauthorizedException('Invalid credentials');
    }

    const meta   = this.extractMeta(req);
    const tokens = await this.authService.opaqueLogin(dto.userIdentifier, meta);

    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  // Legacy password endpoints (kept for migration / fallback)

  @Throttle({ default: { ttl: 900_000, limit: 5 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta   = this.extractMeta(req);
    const result = await this.authService.register(dto, meta);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, workspaceSlug: result.workspaceSlug };
  }

  @Throttle({ default: { ttl: 900_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const meta   = this.extractMeta(req);
    const tokens = await this.authService.login(dto, meta);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }
  // ----- END OF LEGACY ENDPOINTS -----

  // Refresh
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies['refreshToken'] as string | undefined;
    if (!rawToken) throw new UnauthorizedException('Refresh token missing');

    const meta   = this.extractMeta(req);
    const tokens = await this.authService.refresh(rawToken, meta);

    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  // Logout 
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies['refreshToken'] as string | undefined;
    if (rawToken) {
      await this.authService.logout(rawToken);
    }
    this.clearRefreshCookie(res);
  }

  // Logout All Devices 
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  async logoutAll(
    @CurrentUser() user: JWTPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logoutAll(user.sub);
    this.clearRefreshCookie(res);
  }

  // Email Verification 
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  // Sessions
  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@CurrentUser() user: JWTPayload) {
    return this.authService.getUserSessions(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: JWTPayload,
    @Param('id') sessionId: string,
  ) {
    await this.authService.revokeSession(user.sub, sessionId);
  }

  // Private 
  private setRefreshCookie(res: Response, token: string): void {
    res.cookie('refreshToken', token, {
      httpOnly:  true,
      secure:    this.isProd,
      sameSite:  'lax',
      path: '/',
      maxAge:    refreshCookieOptions(this.isProd).maxAge,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie('refreshToken', {
      ...refreshCookieOptions(this.isProd),
      maxAge: 0,
    });
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Put('me/public-key')
  async publishPublicKey(
    @CurrentUser() user: JWTPayload,
    @Body() body: { publicKey: string },
  ) {
    if (!body.publicKey || typeof body.publicKey !== 'string') {
      throw new BadRequestException('publicKey is required');
    }
    await this.authService.publishPublicKey(user.sub, body.publicKey);
  }

  private extractMeta(req: Request) {
    return {
      ip:        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                   ?? req.ip
                   ?? 'unknown',
      userAgent: req.headers['user-agent'] ?? 'unknown',
    };
  }
}