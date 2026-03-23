import { MailerModule } from "@nestjs-modules/mailer";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EmailService } from "./email.service";

@Module({
    imports: [
        MailerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const host = config.get<string>('MAIL_HOST');
                if (!host) {
                    return {
                        transport: {
                            jsonTransport: true, // development/no SMTP fallback
                        },
                        defaults: {
                            from: '"Nexus Team SaaS" <no-reply@nexus-team.local>',
                        },
                    };
                }

                return {
                    transport: {
                        host,
                        port: config.get<number>('MAIL_PORT') || 587,
                        auth: {
                            user: config.get('MAIL_USER'),
                            pass: config.get('MAIL_PASS'),
                        },
                    },
                    defaults: {
                        from: '"Nexus Team SaaS" <no-reply@nexus-team.local>',
                    },
                };
            },
        }),
    ],
    providers: [EmailService],
    exports: [EmailService],
})
export class EmailModule {}