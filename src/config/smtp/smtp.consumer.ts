import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAME } from '../bull/bull.interface';
import { SmtpService } from './smtp.service';
import { registrationMessage, resetPasswordMessage } from './smtp.interface';

@Processor(QUEUE_NAME.smtp)
export class SmtpConsumer {
  constructor(private smtpService: SmtpService) {}

  @Process('registrationMessage')
  async registrationJob(job: Job<registrationMessage>) {
    const { data } = job;
    await this.smtpService.registrationMessage(data.email);
  }

  @Process('resetPasswordMessage')
  async resetPasswordJob(job: Job<resetPasswordMessage>) {
    const { data } = job;
    console.log(data);
    await this.smtpService.resetPasswordMessage(data.email, data.link);
  }
}
