import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { RegisterDto } from './dto/register.dto';
import { SessionMeta } from './interfaces/session-meta.interface';
import * as bcrypt from 'bcrypt';
import { generateToken } from './utils/token.util';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService
    ) {}

    async register(dto: RegisterDto, meta: SessionMeta) {
        const { email, password, confirmPassword, name } = dto;

        if (password !== confirmPassword) throw new BadRequestException("Passwords do not match");

        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.user.findFirst({
                where: {
                    OR: [
                        { email },
                        { name }
                    ]
                }
            })

            if (existing) throw new BadRequestException("Email or username already in use");

            const hashedPassword = await bcrypt.hash(password, 10);
            const verifyToken = generateToken();

            const user = await tx.user.create({
                data: {
                    email,
                    name,
                    password: hashedPassword,
                    
                }
            })
        })
    }
}
