import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TransactionStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { TransactionType } from './enums/transaction-type';
import { ReceiptConversionSide } from './dto/transaction-receipt.dto';

describe('PaymentsService', () => {
  const makeService = (prismaMock: any): PaymentsService =>
    new PaymentsService(
      prismaMock as any,
      {} as any,
      {} as any,
      { create: jest.fn() } as any,
      { get: jest.fn() } as any,
      { get: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { processInternalTransfer: jest.fn(), processWithdraw: jest.fn() } as any,
    );

  it('builds receipt by transaction_id and masks accounts', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ address: 'TABCDEF1234567890' }),
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
    expect(receipt.account_details).toBe('****22223333');
    expect(receipt.paid_from_account).toBe('****34567890');
    expect(receipt.receipt_number).toBe(`TX-10-${createdAt.getTime()}`);
  });

  it('returns fee=0 and fallback recipient when fee is missing', async () => {
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ address: '0xmywallet00001111' }),
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
    expect(receipt.account_details).toBe('****receiver');
    expect(receipt.paid_from_account).toBe('****0xsender');
  });

  it('returns masked fallback accounts instead of bank operation labels', async () => {
    const createdAt = new Date('2026-02-02T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmywallet' }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 12,
          kind: 'BANK_TO_WALLET',
          status: TransactionStatus.SUCCESS,
          amount_in: '100',
          asset_in: 'SOM',
          amount_out: '100',
          asset_out: 'ESOM',
          fee_amount: '5.5',
          tx_hash: null,
          bank_op_id: 531938,
          sender_customer_id: 7,
          receiver_customer_id: null,
          sender_wallet_address: null,
          receiver_wallet_address: null,
          external_address: null,
          comment: null,
          createdAt,
          sender_customer: {
            address: null,
            first_name: 'Zalkar',
            middle_name: null,
            last_name: 'Tilenbaev',
          },
          receiver_customer: null,
        }),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({ transaction_id: 12 }, 7);

    expect(receipt.account_details).toBe('****531938');
    expect(receipt.paid_from_account).toBe('****7');
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
          asset_out: 'USDT_TRC20',
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

    const receipt = await service.getReceipt(
      {
        transaction_id: 88,
        conversion_side: ReceiptConversionSide.OUT,
      },
      7,
    );

    expect(receipt.amount).toBe(0.002);
    expect(receipt.currency).toBe('USDT_TRC20');
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

    await expect(
      service.getReceipt({ transaction_id: 99999 }, 7),
    ).rejects.toBeInstanceOf(NotFoundException);
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

    await expect(
      service.getReceipt({ transaction_id: 10 }, 7),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
            asset_out: 'USDT_TRC20',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: null,
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory({} as any, 7);

    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(77);
    expect(rows[0].transaction_id).toBe(77);
    expect(rows[0].conversion_side).toBe(ReceiptConversionSide.OUT);
  });

  it('returns output side for SOM to USDT bridge conversion history', async () => {
    const createdAt = new Date('2026-06-12T10:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 325,
            kind: 'CONVERSION',
            status: TransactionStatus.SUCCESS,
            amount_in: '100',
            asset_in: 'ESOM',
            amount_out: '0.9945',
            asset_out: 'USDT_TRC20',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: null,
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory(
      {
        currency: ['USDT_TRC20'] as any,
        take: 5,
        skip: 0,
      } as any,
      7,
    );

    expect(rows).toEqual([
      {
        id: 325,
        transaction_id: 325,
        currency: 'USDT_TRC20',
        amount: 0.9945,
        type: TransactionType.CONVERSION,
        conversion_side: ReceiptConversionSide.OUT,
        successful: true,
        created_at: createdAt.getTime(),
      },
    ]);
  });

  it('hides internal bridge transactions from history', async () => {
    const createdAt = new Date('2026-06-12T10:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 326,
            kind: 'BANK_TO_WALLET',
            status: TransactionStatus.SUCCESS,
            amount_in: '100',
            asset_in: 'SOM',
            amount_out: '100',
            asset_out: 'ESOM',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: null,
            comment: 'INTERNAL_BRIDGE SOM->ESOM for SOM->USDT_TRC20 (ABS-1)',
          },
          {
            id: 327,
            kind: 'CONVERSION',
            status: TransactionStatus.SUCCESS,
            amount_in: '100',
            asset_in: 'ESOM',
            amount_out: '1',
            asset_out: 'USDT_TRC20',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: null,
            comment: 'Convert ESOM->USDT_TRC20',
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory(
      {
        currency: ['ESOM', 'USDT_TRC20'] as any,
        take: 10,
        skip: 0,
      } as any,
      7,
    );

    expect(rows.map((row) => row.id)).toEqual([327]);
    expect(rows[0].currency).toBe('USDT_TRC20');
  });

  it('creates SOM purchase accounting postings with the provided account map', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 6 });
    const service = makeService({
      accountingPosting: {
        createMany,
      },
    });

    await (service as any).createSomPurchaseAccountingPostings(
      {
        accountingPosting: {
          createMany,
        },
      },
      {
        transactionId: 42,
        paymentOperationId: 9,
        postingGroupKey: 'som-purchase-42',
        grossAmount: 10000,
        commissionAmount: 100,
        netAmount: 9900,
        bankOperationId: 123456,
        transactionRef: 'ABS-1',
        internalBridge: false,
      },
    );

    expect(createMany).toHaveBeenCalledTimes(1);
    const payload = createMany.mock.calls[0][0];
    expect(payload.data).toHaveLength(6);
    expect(payload.data[0]).toMatchObject({
      posting_group_key: 'som-purchase-42',
      sequence: 1,
      debit_account_no: '20201',
      credit_account_no: '21199',
      amount: '10000',
    });
    expect(payload.data[1]).toMatchObject({
      sequence: 2,
      debit_account_no: '21199',
      credit_account_no: '21113',
      amount: '100',
    });
    expect(payload.data[5]).toMatchObject({
      sequence: 6,
      debit_account_no: '90001',
      credit_account_no: '92602',
      amount: '9900',
    });
  });

  it('creates SOM redemption accounting postings with the provided account map', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 6 });
    const service = makeService({
      accountingPosting: {
        createMany,
      },
    });

    await (service as any).createSomRedemptionAccountingPostings(
      {
        accountingPosting: {
          createMany,
        },
      },
      {
        transactionId: 43,
        paymentOperationId: 10,
        postingGroupKey: 'som-redemption-43',
        grossAmount: 10000,
        commissionAmount: 100,
        netAmount: 9900,
        bankOperationId: 654321,
        transactionRef: 'ABS-2',
      },
    );

    expect(createMany).toHaveBeenCalledTimes(1);
    const payload = createMany.mock.calls[0][0];
    expect(payload.data).toHaveLength(6);
    expect(payload.data[0]).toMatchObject({
      posting_group_key: 'som-redemption-43',
      sequence: 1,
      debit_account_no: '21199',
      credit_account_no: '20201',
      amount: '10000',
      comment: 'Выплата клиенту',
    });
    expect(payload.data[1]).toMatchObject({
      sequence: 2,
      debit_account_no: '21199',
      credit_account_no: '21113',
      amount: '100',
      comment: 'Удержание комиссии',
    });
    expect(payload.data[5]).toMatchObject({
      sequence: 6,
      debit_account_no: '92602',
      credit_account_no: '90001',
      amount: '9900',
    });
  });

  it('normalizes ESOM wallet to ethereum address during USDT to ESOM conversion', async () => {
    const prismaMock = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ status: 'ACTIVE' })
          .mockResolvedValueOnce({
            tariff_category: 'K1',
            residency: 'RESIDENT',
          }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          customer_id: 7,
          address: 'TWrongTronAddress123456789',
          private_key:
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      userAssetBalance: {
        findUnique: jest.fn().mockResolvedValue({ balance: '10' }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      tariffSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      transaction: {
        create: jest.fn().mockResolvedValue({ id: 501 }),
      },
    };

    const ethereumService = {
      getAddressFromPrivateKey: jest
        .fn()
        .mockReturnValue('0x1111111111111111111111111111111111111111'),
      validateAddress: jest.fn().mockReturnValue(false),
      generateAddress: jest.fn(),
      transferFromFiat: jest.fn().mockResolvedValue({ success: true }),
    };

    const service = new PaymentsService(
      prismaMock as any,
      ethereumService as any,
      {} as any,
      { create: jest.fn() } as any,
      {} as any,
      {
        get: jest.fn().mockResolvedValue({
          esom_per_usd: '1',
          btc_trade_fee_pct: '0',
          eth_trade_fee_pct: '0',
          usdt_trade_fee_pct: '0',
        }),
      } as any,
      {} as any,
      {
        refreshAllBalancesForUser: jest.fn().mockResolvedValue(undefined),
      } as any,
      {
        checkTransactionDetailed: jest
          .fn()
          .mockResolvedValue({ allowed: true }),
      } as any,
      {} as any,
      {} as any,
    );

    await service.convert(
      {
        asset_from: 'USDT_TRC20' as any,
        asset_to: 'ESOM' as any,
        amount_from: 5,
      },
      7,
    );

    expect(prismaMock.customer.update).toHaveBeenCalledWith({
      where: { customer_id: 7 },
      data: {
        address: '0x1111111111111111111111111111111111111111',
        private_key:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      },
    });
    expect(ethereumService.transferFromFiat).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      5,
    );
  });
});
