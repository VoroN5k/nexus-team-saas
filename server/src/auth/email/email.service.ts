import { Injectable, Logger } from "@nestjs/common";
import { MailerService } from "@nestjs-modules/mailer";

@Injectable()
export class EmailService {
    private readonly logger = new Logger(EmailService.name);

    constructor(private readonly mailer: MailerService) {}

    async sendVerificationEmail(email:string, token: string) {
        const verificationLink = `http://localhost:4000/api/auth/verify-email?token=${token}`;
        try {
            await this.mailer.sendMail({
                to: email,
                subject: "Verify your email",
                html: `<p>Click <a href="${verificationLink}">here</a> to verify your email.</p>`,
            });
            this.logger.log(`Verification email queued for ${email}`);
        } catch (error) {
            this.logger.warn(`Failed to send verification email to ${email}: ${error?.message || error}`);
            // don't block user registration if email cannot be delivered in dev env
        }
    }
}