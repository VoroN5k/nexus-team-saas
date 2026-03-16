import { Injectable } from "@nestjs/common";
import { MailerService } from "@nestjs-modules/mailer";

@Injectable()
export class EmailService {
    constructor(private readonly mailer: MailerService) {}

    async sendVerificationEmail(email:string, token: string) {
        const verificationLink = `http://localhost:4000/api/auth/verify-email?token=${token}`;
        await this.mailer.sendMail({
            to: email,
            subject: "Verify your email",
            html: `<p>Click <a href="${verificationLink}">here</a> to verify your email.</p>`
        });
    }
}