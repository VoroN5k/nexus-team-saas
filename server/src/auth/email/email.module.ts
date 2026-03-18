import { MailerModule } from "@nestjs-modules/mailer";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EmailService } from "./email.service";

@Module({
    imports: [
        MailerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                transport: {
                    host: config.get('MAIL_HOST'),
                    port: config.get<number>('MAIL_PORT') || 587,
                    auth: {
                        user: config.get('MAIL_USER'),
                        pass: config.get('MAIL_PASS'),
                    },
                },
            }),
        }),
    ],
    providers: [EmailService],
    exports: [EmailService],
})
export class EmailModule {}