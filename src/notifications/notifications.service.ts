import { Injectable } from '@nestjs/common';
import { NotificationDto } from './dto/notification.dto';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private readonly prismaService: PrismaClient) {
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
}
