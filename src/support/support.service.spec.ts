import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupportMessageRole, SupportTicketStatus } from '@prisma/client';
import { SupportService } from './support.service';

type PrismaMock = {
  supportTicket: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
  };
  supportMessage: {
    findMany: jest.Mock;
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  return {
    supportTicket: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    supportMessage: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('SupportService', () => {
  it('creates a new OPEN ticket when user sends first message', async () => {
    const prisma = createPrismaMock();
    const now = new Date('2026-05-06T10:00:00.000Z');

    prisma.supportTicket.findFirst.mockResolvedValue(null);
    prisma.supportTicket.create.mockResolvedValue({ id: 10 });
    prisma.supportMessage.create.mockResolvedValue({
      id: 100,
      ticket_id: 10,
      customer_id: 777,
      role: SupportMessageRole.USER,
      text: 'hello',
      createdAt: now,
    });
    prisma.supportTicket.update.mockResolvedValue({});

    const service = new SupportService(prisma as any);
    const result = await service.sendMessage(777, 'hello');

    expect(result.ticket_id).toBe(10);
    expect(result.role).toBe(SupportMessageRole.USER);
    expect(prisma.supportTicket.create).toHaveBeenCalledTimes(1);
    expect(prisma.supportMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticket_id: 10,
        customer_id: 777,
        text: 'hello',
        role: SupportMessageRole.USER,
      }),
    });
  });

  it('reuses active OPEN ticket for consecutive user messages', async () => {
    const prisma = createPrismaMock();
    const now = new Date('2026-05-06T10:00:00.000Z');

    prisma.supportTicket.findFirst.mockResolvedValue({ id: 44 });
    prisma.supportMessage.create.mockResolvedValue({
      id: 1,
      ticket_id: 44,
      customer_id: 777,
      role: SupportMessageRole.USER,
      text: 'hello',
      createdAt: now,
    });
    prisma.supportTicket.update.mockResolvedValue({});

    const service = new SupportService(prisma as any);
    await service.sendMessage(777, 'hello');
    await service.sendMessage(777, 'again');

    expect(prisma.supportTicket.create).not.toHaveBeenCalled();
    expect(prisma.supportMessage.create).toHaveBeenCalledTimes(2);
    expect(prisma.supportMessage.create.mock.calls[1][0].data.ticket_id).toBe(44);
  });

  it('creates ADMIN reply for OPEN ticket', async () => {
    const prisma = createPrismaMock();
    const now = new Date('2026-05-06T11:00:00.000Z');

    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 5,
      customer_id: 321,
      status: SupportTicketStatus.OPEN,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      lastMessageAt: now,
      closed_by_admin_id: null,
    });

    prisma.supportMessage.create.mockResolvedValue({
      id: 500,
      ticket_id: 5,
      customer_id: 321,
      role: SupportMessageRole.ADMIN,
      text: 'answer',
      createdAt: now,
    });
    prisma.supportTicket.update.mockResolvedValue({});

    const service = new SupportService(prisma as any);
    const result = await service.replyToTicket(5, 11, 'answer');

    expect(result.role).toBe(SupportMessageRole.ADMIN);
    expect(result.ticket_id).toBe(5);
    expect(prisma.supportMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ticket_id: 5, role: SupportMessageRole.ADMIN }),
    });
  });

  it('closes OPEN ticket and sets closed timestamp', async () => {
    const prisma = createPrismaMock();
    const now = new Date('2026-05-06T12:00:00.000Z');
    const closedAt = new Date('2026-05-06T12:05:00.000Z');

    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 9,
      customer_id: 321,
      status: SupportTicketStatus.OPEN,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      lastMessageAt: now,
      closed_by_admin_id: null,
    });

    prisma.supportTicket.update.mockResolvedValue({
      id: 9,
      customer_id: 321,
      status: SupportTicketStatus.CLOSED,
      createdAt: now,
      updatedAt: closedAt,
      closedAt,
      lastMessageAt: now,
      closed_by_admin_id: 1,
    });

    const service = new SupportService(prisma as any);
    const result = await service.closeTicket(9, 1);

    expect(result.status).toBe(SupportTicketStatus.CLOSED);
    expect(result.closed_at).toBe(closedAt.getTime());
  });

  it('throws error when admin replies to CLOSED ticket', async () => {
    const prisma = createPrismaMock();
    const now = new Date('2026-05-06T12:00:00.000Z');

    prisma.supportTicket.findUnique.mockResolvedValue({
      id: 12,
      customer_id: 321,
      status: SupportTicketStatus.CLOSED,
      createdAt: now,
      updatedAt: now,
      closedAt: now,
      lastMessageAt: now,
      closed_by_admin_id: 1,
    });

    const service = new SupportService(prisma as any);

    await expect(service.replyToTicket(12, 1, 'text')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns user history in ascending order request', async () => {
    const prisma = createPrismaMock();
    const first = new Date('2026-05-06T09:00:00.000Z');
    const second = new Date('2026-05-06T10:00:00.000Z');

    prisma.supportMessage.findMany.mockResolvedValue([
      { id: 1, ticket_id: 1, customer_id: 2, role: SupportMessageRole.USER, text: 'a', createdAt: first },
      { id: 2, ticket_id: 1, customer_id: 2, role: SupportMessageRole.ADMIN, text: 'b', createdAt: second },
    ]);

    const service = new SupportService(prisma as any);
    const history = await service.getSupportHistory(2, 40, 0);

    expect(prisma.supportMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { createdAt: 'asc' },
    }));
    expect(history.map((m) => m.id)).toEqual([1, 2]);
  });

  it('throws not found for unknown ticket messages request', async () => {
    const prisma = createPrismaMock();
    prisma.supportTicket.findUnique.mockResolvedValue(null);

    const service = new SupportService(prisma as any);
    await expect(service.getTicketMessages(999)).rejects.toBeInstanceOf(NotFoundException);
  });
});
