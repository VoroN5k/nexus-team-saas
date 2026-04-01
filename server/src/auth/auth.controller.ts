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
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { JWTPayload } from './interfaces/jwt-payload.interface';

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

  constructor(private readonly authService: AuthService) {}

  // Register
  // Strict rate limit: 5 registrations per 15 minutes per IP
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
    return {
      accessToken:   result.accessToken,
      workspaceSlug: result.workspaceSlug,
    };
  }

  // Login
  // Strict rate limit: 10 attempts per 15 minutes per IP
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
    res.cookie('refreshToken', token, refreshCookieOptions(this.isProd));
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie('refreshToken', {
      ...refreshCookieOptions(this.isProd),
      maxAge: 0,
    });
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