import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, PushPlatform } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { UserInfoDto } from '../users/dto/user-info.dto';
import { PushDataPayloadDto } from './dto/push-test.dto';
import { SendFinancialReportRequestDto, SendFinancialReportResponseDto } from './dto/financial-report.dto';
import { FirebasePushService } from './firebase-push.service';
import { NotificationDto } from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prismaService: PrismaClient,
    private readonly configService: ConfigService,
    private readonly firebasePushService: FirebasePushService,
  ) {}

  async getNotifications(
    _userId: number,
    take: number,
    skip: number,
  ): Promise<NotificationDto[]> {
    const notifications = await this.prismaService.notification.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take,
      skip,
    });

    return notifications.map((t) => ({
      id: t.id,
      text: t.text,
      created_at: t.createdAt.getTime(),
      title: t.title,
    }));
  }

  async sendFinancialReport(
    body: SendFinancialReportRequestDto,
    user: UserInfoDto,
  ): Promise<SendFinancialReportResponseDto> {
    const recipientEmail = (body.email || user.email || '').trim();
    if (!recipientEmail) {
      throw new BadRequestException('Recipient email is required');
    }

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromDate = body.from_time ? new Date(body.from_time) : defaultFrom;
    const toDate = body.to_time ? new Date(body.to_time) : now;

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Invalid report period');
    }

    if (fromDate > toDate) {
      throw new BadRequestException('from_time cannot be greater than to_time');
    }

    const me = await this.prismaService.customer.findUnique({
      where: { customer_id: user.customer_id },
      select: { address: true },
    });

    const userOr = [
      { sender_customer_id: user.customer_id },
      { receiver_customer_id: user.customer_id },
      me?.address ? { sender_wallet_address: me.address } : undefined,
      me?.address ? { receiver_wallet_address: me.address } : undefined,
    ].filter(Boolean) as any[];

    const transactions = await this.prismaService.transaction.findMany({
      where: {
        OR: userOr,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        kind: true,
        status: true,
        amount_in: true,
        asset_in: true,
        amount_out: true,
        asset_out: true,
        createdAt: true,
        comment: true,
      },
    });

    const statusStats = transactions.reduce((acc, tx) => {
      const key = tx.status;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const fio = [user.last_name, user.first_name, user.middle_name]
      .filter(Boolean)
      .join(' ')
      .trim() || `Customer #${user.customer_id}`;

    const rows = transactions.map((tx) => {
      const amountIn = Number(tx.amount_in);
      const amountOut = Number(tx.amount_out);
      return [
        `ID: ${tx.id}`,
        `DATE: ${tx.createdAt.toISOString()}`,
        `KIND: ${tx.kind}`,
        `STATUS: ${tx.status}`,
        `IN: ${amountIn} ${tx.asset_in}`,
        `OUT: ${amountOut} ${tx.asset_out}`,
        `COMMENT: ${tx.comment || '-'}`,
      ].join(' | ');
    });

    const reportText = [
      'FINANCIAL REPORT',
      `Customer: ${fio} (ID: ${user.customer_id})`,
      `Period: ${fromDate.toISOString()} - ${toDate.toISOString()}`,
      `Total operations: ${transactions.length}`,
      `SUCCESS: ${statusStats.SUCCESS || 0}, PENDING: ${statusStats.PENDING || 0}, REJECTED: ${statusStats.REJECTED || 0}, FAILED: ${statusStats.FAILED || 0}`,
      '',
      'Operations:',
      ...(rows.length ? rows : ['No operations for selected period']),
    ].join('\n');

    const emailHost = this.configService.get<string>('EMAIL_HOST');
    const emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPassword = this.configService.get<string>('EMAIL_PASSWORD');
    const emailPort = Number(this.configService.get<string>('EMAIL_PORT') || 587);
    const emailSecure = this.configService.get<string>('EMAIL_SECURE') === 'true' || emailPort === 465;
    const fromEmail = this.configService.get<string>('EMAIL_FROM') || emailUser;

    if (!emailHost || !fromEmail) {
      throw new InternalServerErrorException('Email server is not configured (EMAIL_HOST/EMAIL_FROM)');
    }

    const transporter = nodemailer.createTransport({
      host: emailHost,
      port: emailPort,
      secure: emailSecure,
      auth: emailUser && emailPassword ? { user: emailUser, pass: emailPassword } : undefined,
    });

    try {
      await transporter.sendMail({
        from: fromEmail,
        to: recipientEmail,
        subject: `Salam financial report (${fromDate.toISOString().slice(0, 10)} - ${toDate.toISOString().slice(0, 10)})`,
        text: reportText,
      });
      return { successful: true };
    } catch (error) {
      throw new InternalServerErrorException(`Failed to send report: ${(error as Error)?.message || 'unknown error'}`);
    }
  }

  async sendTestPushToToken(dto: { token: string } & PushDataPayloadDto) {
    const result = await this.firebasePushService.sendToToken(dto.token, {
      title: dto.title,
      text: dto.text,
      url: dto.url,
    });

    return {
      successful: result.ok,
      message_id: result.messageId,
      error: result.error,
    };
  }

  async sendTestPushToCustomer(customerId: number, dto: PushDataPayloadDto) {
    const result = await this.firebasePushService.sendToCustomer(
      customerId,
      {
        title: dto.title,
        text: dto.text,
        url: dto.url,
      },
      PushPlatform.ANDROID,
    );

    return {
      successful: result.sent > 0 && result.failed === 0,
      skipped: result.skipped,
      sent: result.sent,
      failed: result.failed,
      details: result.details,
    };
  }
}
