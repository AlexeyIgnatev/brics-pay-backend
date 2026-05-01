import { Injectable } from '@nestjs/common';
import { PrismaClient, SupportMessageRole } from '@prisma/client';
import { SupportMessageDto } from './dto/support-message.dto';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaClient) {}

  async getSupportMessages(
    customerId: number,
    take = 40,
    skip = 0,
  ): Promise<SupportMessageDto[]> {
    const messages = await this.prisma.supportMessage.findMany({
      where: { customer_id: customerId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    return messages.map((m) => ({
      id: m.id,
      text: m.text,
      created_at: m.createdAt.getTime(),
      role: m.role,
    }));
  }

  async sendMessage(customerId: number, text: string): Promise<SupportMessageDto> {
    await this.prisma.supportMessage.create({
      data: {
        customer_id: customerId,
        text,
        role: SupportMessageRole.USER,
      },
    });

    const supportAnswer = await this.prisma.supportMessage.create({
      data: {
        customer_id: customerId,
        text,
        role: SupportMessageRole.ASSISTANT,
      },
    });

    return {
      id: supportAnswer.id,
      text: supportAnswer.text,
      created_at: supportAnswer.createdAt.getTime(),
      role: supportAnswer.role,
    };
  }
}

