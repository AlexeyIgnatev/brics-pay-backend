import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SmtpService {
  constructor(private readonly smtpService: MailerService) {}

  public async registrationMessage(userEmail: string) {
    console.log('send');
    await this.smtpService.sendMail({
      to: userEmail,
      from: process.env.EMAIL_USER,
      subject: 'Registration',
      text: 'Registration message',
    });
  }

  public async resetPasswordMessage(userEmail: string, link: string) {
    await this.smtpService.sendMail({
      to: userEmail,
      from: process.env.EMAIL_USER,
      subject: 'Reset password ',
      text: `Reset password link: ${link}`,
    });
  }
}
