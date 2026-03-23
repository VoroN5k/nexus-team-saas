import {
    Controller,
    Post,
    Body,
    Res,
    Req,
    UseGuards,
    Get,
    Query,
    UnauthorizedException, Patch,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Post('register')
    async register(
        @Body() dto: RegisterDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const meta = this.extractMeta(req);
        const tokens = await this.authService.register(dto, meta);

        this.setRefreshCookie(res, tokens.refreshToken);
        return { accessToken: tokens.accessToken };
    }

    @Post('login')
    async login(
        @Body() dto: LoginDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const meta = this.extractMeta(req);
        const tokens = await this.authService.login(dto, meta);

        this.setRefreshCookie(res, tokens.refreshToken);
        return { accessToken: tokens.accessToken };
    }

    @Post('refresh')
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const refreshToken = req.cookies['refreshToken'];
        if (!refreshToken) throw new UnauthorizedException('Refresh token missing');

        const meta = this.extractMeta(req);
        const tokens = await this.authService.refresh(refreshToken, meta);

        this.setRefreshCookie(res, tokens.refreshToken);
        return { accessToken: tokens.accessToken };
    }

    @UseGuards(JwtAuthGuard)
    @Get('sessions')
    async getSessions(@CurrentUser('sub') userId: string) {
        return this.authService.getUserSessions(userId);
    }

    @Get('verify-email')
    async verify(@Query('token') token: string) {
        return this.authService.verifyEmail(token);
    }

    private setRefreshCookie(res: Response, token: string) {
        res.cookie('refreshToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/', // Обмежуємо куку лише шляхом оновлення
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 днів
        });
    }

    private extractMeta(req: Request) {
        return {
            ip: req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
        };
    }
}