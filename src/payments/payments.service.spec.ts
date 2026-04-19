import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { TransactionType } from './enums/transaction-type';
import { ReceiptConversionSide } from './dto/transaction-receipt.dto';

describe('PaymentsService', () => {
  const makeService = (prismaMock: any): PaymentsService => new PaymentsService(
    prismaMock as any,
    {} as any,
    {} as any,
    { create: jest.fn() } as any,
    { get: jest.fn() } as any,
    { get: jest.fn() } as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('builds receipt by transaction_id and masks accounts', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: 'TABCDEF1234567890' }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          kind: 'WITHDRAW_CRYPTO',
          status: TransactionStatus.SUCCESS,
          amount_in: '12.5',
          asset_in: 'USDT_TRC20',
          amount_out: '12.5',
          asset_out: 'USDT_TRC20',
          fee_amount: '0.5',
          tx_hash: '0xhash',
          bank_op_id: null,
          sender_customer_id: 7,
          receiver_customer_id: null,
          sender_wallet_address: 'TABCDEF1234567890',
          receiver_wallet_address: null,
          external_address: 'TXYZ0000111122223333',
          comment: null,
          createdAt,
          sender_customer: { address: 'TABCDEF1234567890' },
          receiver_customer: null,
        }),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({ transaction_id: 10 }, 7);

    expect(receipt.successful).toBe(true);
    expect(receipt.amount).toBe(12.5);
    expect(receipt.type).toBe(TransactionType.EXPENSE);
    expect(receipt.currency).toBe('USDT_TRC20');
    expect(receipt.created_at).toBe(createdAt.getTime());
    expect(receipt.fee).toBe(0.5);
    expect(receipt.account_details).toBe('****3333');
    expect(receipt.paid_from_account).toBe('****7890');
    expect(receipt.receipt_number).toBe(`TX-10-${createdAt.getTime()}`);
  });

  it('returns fee=0 and fallback recipient when fee is missing', async () => {
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmywallet00001111' }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 11,
          kind: 'BANK_TO_BANK',
          status: TransactionStatus.SUCCESS,
          amount_in: '1000',
          asset_in: 'SOM',
          amount_out: '1000',
          asset_out: 'SOM',
          fee_amount: null,
          tx_hash: null,
          bank_op_id: 995544,
          sender_customer_id: 7,
          receiver_customer_id: 55,
          sender_wallet_address: null,
          receiver_wallet_address: null,
          external_address: null,
          comment: null,
          createdAt,
          sender_customer: { address: '0xsender' },
          receiver_customer: {
            address: '0xreceiver',
            first_name: null,
            middle_name: null,
            last_name: null,
          },
        }),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({ transaction_id: 11 }, 7);

    expect(receipt.fee).toBe(0);
    expect(receipt.recipient_full_name).toBe('Customer #55');
  });

  it('returns OUT side for conversion when conversion_side=OUT', async () => {
    const createdAt = new Date('2026-04-01T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmywallet' }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 88,
          kind: 'CONVERSION',
          status: TransactionStatus.SUCCESS,
          amount_in: '1000',
          asset_in: 'ESOM',
          amount_out: '0.002',
          asset_out: 'BTC',
          fee_amount: '0.00001',
          tx_hash: null,
          bank_op_id: null,
          sender_customer_id: 7,
          receiver_customer_id: null,
          sender_wallet_address: '0xmywallet',
          receiver_wallet_address: null,
          external_address: null,
          comment: null,
          createdAt,
          sender_customer: { address: '0xmywallet' },
          receiver_customer: null,
        }),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({
      transaction_id: 88,
      conversion_side: ReceiptConversionSide.OUT,
    }, 7);

    expect(receipt.amount).toBe(0.002);
    expect(receipt.currency).toBe('BTC');
  });

  it('throws NotFoundException when transaction does not exist', async () => {
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xabc' }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = makeService(prismaMock);

    await expect(service.getReceipt({ transaction_id: 99999 }, 7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ForbiddenException when transaction does not belong to user', async () => {
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          kind: 'WALLET_TO_WALLET',
          status: TransactionStatus.SUCCESS,
          amount_in: '1',
          asset_in: 'ESOM',
          amount_out: '1',
          asset_out: 'ESOM',
          fee_amount: null,
          tx_hash: null,
          bank_op_id: null,
          sender_customer_id: 123,
          receiver_customer_id: 456,
          sender_wallet_address: '0xsender',
          receiver_wallet_address: '0xreceiver',
          external_address: null,
          comment: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          sender_customer: { address: '0xsender' },
          receiver_customer: {
            address: '0xreceiver',
            first_name: 'John',
            middle_name: null,
            last_name: 'Doe',
          },
        }),
      },
    };
    const service = makeService(prismaMock);

    await expect(service.getReceipt({ transaction_id: 10 }, 7)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns transaction id in history rows', async () => {
    const createdAt = new Date('2026-03-01T10:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 77,
            kind: 'CONVERSION',
            status: TransactionStatus.SUCCESS,
            amount_in: '10',
            asset_in: 'ESOM',
            amount_out: '0.001',
            asset_out: 'BTC',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: null,
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory({} as any, 7);

    expect(rows.length).toBe(2);
    expect(rows[0].id).toBe(77);
    expect(rows[1].id).toBe(77);
  });
});
