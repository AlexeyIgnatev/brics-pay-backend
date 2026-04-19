import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { NotificationDto } from './dto/notification.dto';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SendFinancialReportRequestDto, SendFinancialReportResponseDto } from './dto/financial-report.dto';
import { UserInfoDto } from '../users/dto/user-info.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prismaService: PrismaClient,
    private readonly configService: ConfigService,
  ) {
  }

  async getNotifications(
    userId: number,
    take: number,
    skip: number,
  ): Promise<NotificationDto[]> {
    const notifications = await this.prismaService.notification.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      take: take,
      skip: skip,
    });

    return notifications.map((t) => {
      return {
        id: t.id,
        text: t.text,
        created_at: t.createdAt.getTime(),
        title: t.title,
      };
    });
  }

  async sendFinancialReport(
    body: SendFinancialReportRequestDto,
    user: UserInfoDto,
  ): Promise<SendFinancialReportResponseDto> {
    const recipientEmail = (body.email || user.email || '').trim();
    if (!recipientEmail) {
      throw new BadRequestException('Email получателя не указан');
    }

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const fromDate = body.from_time ? new Date(body.from_time) : defaultFrom;
    const toDate = body.to_time ? new Date(body.to_time) : now;

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Неверный формат периода отчета');
    }

    if (fromDate > toDate) {
      throw new BadRequestException('from_time не может быть больше to_time');
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

    const firstName = user.first_name || '';
    const middleName = user.middle_name || '';
    const lastName = user.last_name || '';
    const fio = [lastName, firstName, middleName].filter(Boolean).join(' ').trim() || `Customer #${user.customer_id}`;

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
      'ФИНАНСОВЫЙ ОТЧЕТ',
      `Клиент: ${fio} (ID: ${user.customer_id})`,
      `Период: ${fromDate.toISOString()} - ${toDate.toISOString()}`,
      `Всего операций: ${transactions.length}`,
      `SUCCESS: ${statusStats.SUCCESS || 0}, PENDING: ${statusStats.PENDING || 0}, REJECTED: ${statusStats.REJECTED || 0}, FAILED: ${statusStats.FAILED || 0}`,
      '',
      'Операции:',
      ...(rows.length ? rows : ['Нет операций за выбранный период']),
    ].join('\n');

    const emailHost = this.configService.get<string>('EMAIL_HOST');
    const emailUser = this.configService.get<string>('EMAIL_USER');
    const emailPassword = this.configService.get<string>('EMAIL_PASSWORD');
    const emailPort = Number(this.configService.get<string>('EMAIL_PORT') || 587);
    const emailSecure = this.configService.get<string>('EMAIL_SECURE') === 'true' || emailPort === 465;
    const fromEmail = this.configService.get<string>('EMAIL_FROM') || emailUser;

    if (!emailHost || !fromEmail) {
      throw new InternalServerErrorException('Почтовый сервер не настроен (EMAIL_HOST/EMAIL_FROM)');
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
        subject: `Финансовый отчет Salam (${fromDate.toISOString().slice(0, 10)} - ${toDate.toISOString().slice(0, 10)})`,
        text: reportText,
      });
      return { successful: true };
    } catch (error) {
      throw new InternalServerErrorException(`Не удалось отправить отчет: ${(error as Error)?.message || 'unknown error'}`);
    }
  }
}
