import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, SupportMessageRole, SupportTicketStatus } from '@prisma/client';
import { SupportMessageDto } from './dto/support-message.dto';
import { SupportTicketDto, SupportTicketsListDto } from './dto/support-ticket.dto';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaClient) {}

  private mapMessage(message: {
    id: number;
    ticket_id: number;
    text: string;
    role: string;
    createdAt: Date;
  }): SupportMessageDto {
    return {
      id: message.id,
      ticket_id: message.ticket_id,
      text: message.text,
      created_at: message.createdAt.getTime(),
      role: message.role,
    };
  }

  private mapTicket(ticket: {
    id: number;
    customer_id: number;
    status: string;
    createdAt: Date;
    lastMessageAt: Date;
    closedAt: Date | null;
  }): SupportTicketDto {
    return {
      id: ticket.id,
      customer_id: ticket.customer_id,
      status: ticket.status,
      created_at: ticket.createdAt.getTime(),
      last_message_at: ticket.lastMessageAt.getTime(),
      closed_at: ticket.closedAt ? ticket.closedAt.getTime() : null,
    };
  }

  private async getOrCreateOpenTicket(customerId: number): Promise<{ id: number }> {
    const existing = await this.prisma.supportTicket.findFirst({
      where: { customer_id: customerId, status: SupportTicketStatus.OPEN },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (existing) return existing;

    return this.prisma.supportTicket.create({
      data: {
        customer_id: customerId,
        status: SupportTicketStatus.OPEN,
      },
      select: { id: true },
    });
  }

  async getSupportHistory(
    customerId: number,
    take = 200,
    skip = 0,
  ): Promise<SupportMessageDto[]> {
    const messages = await this.prisma.supportMessage.findMany({
      where: { customer_id: customerId },
      orderBy: { createdAt: 'asc' },
      take,
      skip,
    });

    return messages.map((m) => this.mapMessage(m));
  }

  async sendMessage(customerId: number, text: string): Promise<SupportMessageDto> {
    const trimmedText = text.trim();
    const ticket = await this.getOrCreateOpenTicket(customerId);

    const message = await this.prisma.supportMessage.create({
      data: {
        customer_id: customerId,
        ticket_id: ticket.id,
        text: trimmedText,
        role: SupportMessageRole.USER,
      },
    });

    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: message.createdAt,
      },
    });

    return this.mapMessage(message);
  }

  async listTickets(
    status: SupportTicketStatus | undefined,
    offset = 0,
    limit = 20,
  ): Promise<SupportTicketsListDto> {
    const where = status ? { status } : undefined;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: offset,
        take: limit,
      }),
    ]);

    return {
      total,
      offset,
      limit,
      items: items.map((ticket) => this.mapTicket(ticket)),
    };
  }

  async getTicketMessages(ticketId: number): Promise<SupportMessageDto[]> {
    await this.ensureTicketExists(ticketId);

    const messages = await this.prisma.supportMessage.findMany({
      where: { ticket_id: ticketId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((m) => this.mapMessage(m));
  }

  async replyToTicket(ticketId: number, adminId: number, text: string): Promise<SupportMessageDto> {
    const trimmedText = text.trim();

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status !== SupportTicketStatus.OPEN) {
      throw new BadRequestException('Ticket is closed');
    }

    const message = await this.prisma.supportMessage.create({
      data: {
        ticket_id: ticket.id,
        customer_id: ticket.customer_id,
        text: trimmedText,
        role: SupportMessageRole.ADMIN,
      },
    });

    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        lastMessageAt: message.createdAt,
        closed_by_admin_id: adminId,
      },
    });

    return this.mapMessage(message);
  }

  async closeTicket(ticketId: number, adminId: number): Promise<SupportTicketDto> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === SupportTicketStatus.CLOSED) return this.mapTicket(ticket);

    const now = new Date();
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: SupportTicketStatus.CLOSED,
        closedAt: now,
        closed_by_admin_id: adminId,
      },
    });

    return this.mapTicket(updated);
  }

  private async ensureTicketExists(ticketId: number): Promise<void> {
    const exists = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Ticket not found');
  }
}
