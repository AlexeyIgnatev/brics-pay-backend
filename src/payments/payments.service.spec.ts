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
      {} as any,
      {
        get: jest.fn(),
        getAdmin: jest.fn().mockResolvedValue({
          bank_commission_central_bank_pct: '20',
          bank_commission_bank_pct: '40',
          bank_commission_partners_pct: '40',
          bank_commission_distribution_mode: 'PERCENT',
          bank_commission_central_bank_fixed: '0',
          bank_commission_bank_fixed: '0',
          bank_commission_partners_fixed: '0',
          bank_commission_central_bank_som_account: '910000001',
          bank_commission_bank_som_account: '1340000096184177',
          bank_commission_partners_json:
            '[{"id":"partner-1","title":"Partner 1","som_account":"910000003","salam_wallet":"0x3333333333333333333333333333333333333333","usdt_wallet":"TQYvtaMVomk4BFgGPNjnEadrnVaLAqS5Kj"}]',
        }),
        parsePartnersJsonForCommission: jest.fn().mockReturnValue([
          {
            id: 'partner-1',
            title: 'Partner 1',
            som_account: '910000003',
            salam_wallet: '0x3333333333333333333333333333333333333333',
            usdt_wallet: 'TQYvtaMVomk4BFgGPNjnEadrnVaLAqS5Kj',
          },
        ]),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { processInternalTransfer: jest.fn(), processWithdraw: jest.fn() } as any,
    );

  it('returns recipient name by phone number', async () => {
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          first_name: 'Иван',
          middle_name: 'Иванович',
          last_name: 'Иванов',
        }),
      },
    };
    const service = makeService(prismaMock);
    (service as any).bricsService = {
      findAccount: jest.fn().mockResolvedValue({ CustomerID: 55 }),
    };

    await expect(
      service.getRecipientInfo(
        {
          phone_number: '996777960777',
          address: null,
          currency: 'SOM' as any,
        },
        7,
      ),
    ).resolves.toEqual({
      first_name: 'Иван',
      middle_name: 'Иванович',
      last_name: 'Иванов',
    });
  });

  it('loads recipient name from ABS when the local name is empty', async () => {
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          first_name: null,
          middle_name: null,
          last_name: null,
        }),
      },
    };
    const service = makeService(prismaMock);
    (service as any).bricsService = {
      findAccount: jest.fn().mockResolvedValue({ CustomerID: 55 }),
      getCustomerInfoById: jest.fn().mockResolvedValue({
        CustomerName: 'Иван',
        Otchestvo: 'Иванович',
        Surname: 'Иванов',
      }),
    };

    await expect(
      service.getRecipientInfo(
        {
          phone_number: '996777960777',
          address: null,
          currency: 'USDT_TRC20' as any,
        },
        7,
      ),
    ).resolves.toEqual({
      first_name: 'Иван',
      middle_name: 'Иванович',
      last_name: 'Иванов',
    });
  });

  it('builds receipt by transaction_id with full reusable accounts', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ address: 'TRVh3EuuWTkCfECfXM77SGZZZQwJT49WBm' }),
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
          sender_wallet_address: 'TRVh3EuuWTkCfECfXM77SGZZZQwJT49WBm',
          receiver_wallet_address: null,
          external_address: 'TAkrzNdEsCbiHwBXzTKX72NLkoLtXh1SFv',
          comment: null,
          createdAt,
          sender_customer: {
            address: '0x1111111111111111111111111111111111111111',
            phone: null,
            private_key: null,
          },
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
    expect(receipt.account_details).toBe('TAkrzNdEsCbiHwBXzTKX72NLkoLtXh1SFv');
    expect(receipt.paid_from_account).toBe(
      'TRVh3EuuWTkCfECfXM77SGZZZQwJT49WBm',
    );
    expect(receipt.receipt_number).toBe(`TX-10-${createdAt.getTime()}`);
  });

  it('builds a SOM receipt when an older client sends the ABS operation id', async () => {
    const createdAt = new Date('2026-08-12T00:00:00.000Z');
    const somTransaction = {
      id: 25,
      kind: 'BANK_TO_BANK',
      status: TransactionStatus.SUCCESS,
      amount_in: '50',
      asset_in: 'SOM',
      amount_out: '50',
      asset_out: 'SOM',
      fee_amount: '0',
      tx_hash: null,
      bank_op_id: 44858139,
      sender_customer_id: 7,
      receiver_customer_id: 55,
      sender_wallet_address: null,
      receiver_wallet_address: null,
      external_address: null,
      comment: 'SOM transfer',
      createdAt,
      ledger_entries: [],
      sender_customer: {
        address: null,
        first_name: 'Sender',
        middle_name: null,
        last_name: 'User',
      },
      receiver_customer: {
        address: null,
        first_name: 'Receiver',
        middle_name: null,
        last_name: 'User',
      },
    };
    const prismaMock = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ address: '0xmywallet' })
          .mockResolvedValueOnce(null),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(somTransaction),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({ transaction_id: 44858139 }, 7);

    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bank_op_id: 44858139 } }),
    );
    expect(receipt).toMatchObject({
      successful: true,
      amount: 50,
      currency: 'SOM',
      type: TransactionType.EXPENSE,
      recipient_full_name: 'User Receiver',
    });
    expect(receipt.receipt_number).toBe(`TX-25-${createdAt.getTime()}`);
  });

  it('uses phone numbers instead of crypto wallets in a SOM transfer receipt', async () => {
    const createdAt = new Date('2026-08-13T06:35:24.034Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xsender' }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 666,
          kind: 'BANK_TO_BANK',
          status: TransactionStatus.SUCCESS,
          amount_in: '50',
          asset_in: 'SOM',
          amount_out: '50',
          asset_out: 'SOM',
          fee_amount: '5',
          tx_hash: null,
          bank_op_id: 44858139,
          sender_customer_id: 7,
          receiver_customer_id: 55,
          sender_wallet_address: '0xwrong-sender-wallet',
          receiver_wallet_address: '0xwrong-receiver-wallet',
          external_address: null,
          comment: 'SOM transfer',
          createdAt,
          sender_customer: {
            address: '0xsender',
            phone: '+996777111222',
            private_key: null,
          },
          receiver_customer: {
            address: '0xreceiver',
            phone: '+996777960777',
            private_key: null,
            first_name: 'Ivan',
            middle_name: null,
            last_name: 'Ivanov',
          },
          ledger_entries: [],
        }),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({ transaction_id: 666 }, 7);

    expect(receipt.paid_from_account).toBe('+996777111222');
    expect(receipt.account_details).toBe('+996777960777');
  });

  it('uses distinct currency wallets in ESOM and USDT receipts', async () => {
    const createdAt = new Date('2026-08-13T06:35:24.034Z');
    const transaction = {
      id: 667,
      kind: 'WALLET_TO_WALLET',
      status: TransactionStatus.SUCCESS,
      amount_in: '3',
      amount_out: '3',
      fee_amount: '0.03',
      tx_hash: null,
      bank_op_id: null,
      sender_customer_id: 7,
      receiver_customer_id: 55,
      sender_wallet_address: '0x1111111111111111111111111111111111111111',
      receiver_wallet_address: '0x2222222222222222222222222222222222222222',
      external_address: null,
      comment: null,
      createdAt,
      sender_customer: {
        address: '0x1111111111111111111111111111111111111111',
        phone: '+996777111222',
        private_key: 'sender-key',
      },
      receiver_customer: {
        address: '0x2222222222222222222222222222222222222222',
        phone: '+996777960777',
        private_key: 'receiver-key',
        first_name: 'Ivan',
        middle_name: null,
        last_name: 'Ivanov',
      },
      ledger_entries: [],
    };
    const prismaMock = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ address: transaction.sender_customer.address }),
      },
      transaction: { findUnique: jest.fn() },
    };
    const service = makeService(prismaMock);
    (service as any).cryptoService = {
      trxAddressFromPrivateKey: jest.fn((key: string) =>
        key === 'sender-key'
          ? 'TRVh3EuuWTkCfECfXM77SGZZZQwJT49WBm'
          : 'TAkrzNdEsCbiHwBXzTKX72NLkoLtXh1SFv',
      ),
    };

    prismaMock.transaction.findUnique.mockResolvedValue({
      ...transaction,
      asset_in: 'ESOM',
      asset_out: 'ESOM',
    });
    const esomReceipt = await service.getReceipt({ transaction_id: 667 }, 7);

    prismaMock.transaction.findUnique.mockResolvedValue({
      ...transaction,
      asset_in: 'USDT_TRC20',
      asset_out: 'USDT_TRC20',
    });
    const usdtReceipt = await service.getReceipt({ transaction_id: 667 }, 7);

    expect(esomReceipt.paid_from_account).toBe(
      '0x1111111111111111111111111111111111111111',
    );
    expect(esomReceipt.account_details).toBe(
      '0x2222222222222222222222222222222222222222',
    );
    expect(usdtReceipt.paid_from_account).toBe(
      'TRVh3EuuWTkCfECfXM77SGZZZQwJT49WBm',
    );
    expect(usdtReceipt.account_details).toBe(
      'TAkrzNdEsCbiHwBXzTKX72NLkoLtXh1SFv',
    );
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
      tariffSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({ transaction_id: 11 }, 7);

    expect(receipt.fee).toBe(0);
    expect(receipt.recipient_full_name).toBe('Customer #55');
    expect(receipt.account_details).toBe('55');
    expect(receipt.paid_from_account).toBe('7');
  });

  it('falls back to tariff fee in receipt for wallet-to-wallet USDT transfer', async () => {
    const createdAt = new Date('2026-02-01T00:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ address: '0xmywallet' })
          .mockResolvedValueOnce({
            tariff_category: 'K1',
            residency: 'RESIDENT',
          }),
      },
      tariffSetting: {
        findUnique: jest.fn().mockResolvedValue({
          percent_fee: '10',
          fixed_fee: '0',
        }),
      },
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          id: 13,
          kind: 'WALLET_TO_WALLET',
          status: TransactionStatus.SUCCESS,
          amount_in: '100',
          asset_in: 'USDT_TRC20',
          amount_out: '90',
          asset_out: 'USDT_TRC20',
          fee_amount: null,
          tx_hash: null,
          bank_op_id: null,
          sender_customer_id: 7,
          receiver_customer_id: 55,
          sender_wallet_address: 'Tsender',
          receiver_wallet_address: 'Treceiver',
          external_address: null,
          comment: null,
          createdAt,
          sender_customer: { address: 'Tsender' },
          receiver_customer: {
            address: 'Treceiver',
            first_name: null,
            middle_name: null,
            last_name: null,
          },
        }),
      },
    };
    const service = makeService(prismaMock);

    const receipt = await service.getReceipt({ transaction_id: 13 }, 7);

    expect(receipt.fee).toBe(10);
    expect(receipt.amount).toBe(100);
  });

  it('uses the larger of percentage fee and minimum fee for tariff calculation', async () => {
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          tariff_category: 'K1',
          residency: 'RESIDENT',
        }),
      },
      tariffSetting: {
        findUnique: jest.fn().mockResolvedValue({
          percent_fee: '10',
          fixed_fee: '35',
        }),
      },
    };
    const service = makeService(prismaMock);

    const result = await (service as any).getCustomerTariffFee(
      7,
      'SOM_TO_SALAM',
      1000,
    );

    expect(result).toMatchObject({
      percent: 10,
      fixed: 35,
      fee: 100,
      configured: true,
    });
  });

  it('returns fallback account identifiers instead of bank operation labels', async () => {
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

    expect(receipt.account_details).toBe('531938');
    expect(receipt.paid_from_account).toBe('7');
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
        findFirst: jest.fn().mockResolvedValue(null),
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

  it('shows the full credited amount when sender pays the fee on top', async () => {
    const createdAt = new Date('2026-06-12T12:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 401,
            kind: 'WALLET_TO_WALLET',
            status: TransactionStatus.SUCCESS,
            amount_in: '10',
            asset_in: 'USDT_TRC20',
            amount_out: '10',
            asset_out: 'USDT_TRC20',
            fee_amount: '4',
            createdAt,
            sender_customer_id: 11,
            receiver_customer_id: 7,
            sender_customer: {
              first_name: 'Кылыч',
              middle_name: 'Бегималыевич',
              last_name: 'Куталиев',
            },
            receiver_customer: null,
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory({} as any, 7);

    expect(rows).toEqual([
      {
        id: 401,
        transaction_id: 401,
        currency: 'USDT_TRC20',
        amount: 10,
        type: TransactionType.INCOME,
        conversion_side: undefined,
        sender_full_name: 'Куталиев Кылыч Бегималыевич',
        successful: true,
        created_at: createdAt.getTime(),
      },
    ]);
  });

  it('shows amount plus fee for an outgoing USDT transfer', async () => {
    const createdAt = new Date('2026-08-13T10:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: 'Tsender' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 404,
            kind: 'WALLET_TO_WALLET',
            status: TransactionStatus.SUCCESS,
            amount_in: '3',
            asset_in: 'USDT_TRC20',
            amount_out: '3',
            asset_out: 'USDT_TRC20',
            fee_amount: '0.03',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: 11,
            sender_wallet_address: 'Tsender',
            receiver_wallet_address: 'Treceiver',
            sender_customer: null,
            receiver_customer: {
              first_name: 'Кылыч',
              middle_name: 'Бегималыевич',
              last_name: 'Куталиев',
            },
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory({} as any, 7);

    expect(rows).toEqual([
      {
        id: 404,
        transaction_id: 404,
        currency: 'USDT_TRC20',
        amount: 3.03,
        type: TransactionType.EXPENSE,
        conversion_side: undefined,
        recipient_full_name: 'Куталиев Кылыч Бегималыевич',
        successful: true,
        created_at: createdAt.getTime(),
      },
    ]);
  });

  it('returns recipient name only for an outgoing user transfer', async () => {
    const createdAt = new Date('2026-08-01T07:00:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xsender' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 402,
            kind: 'BANK_TO_BANK',
            status: TransactionStatus.SUCCESS,
            amount_in: '100',
            asset_in: 'SOM',
            amount_out: '100',
            asset_out: 'SOM',
            fee_amount: '0',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: 11,
            sender_customer: null,
            receiver_customer: {
              first_name: 'Максат',
              middle_name: 'Шамшидинович',
              last_name: 'Кыдыкеев',
            },
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory({} as any, 7);

    expect(rows).toEqual([
      {
        id: 402,
        transaction_id: 402,
        currency: 'SOM',
        amount: 100,
        type: TransactionType.EXPENSE,
        conversion_side: undefined,
        recipient_full_name: 'Кыдыкеев Максат Шамшидинович',
        successful: true,
        created_at: createdAt.getTime(),
      },
    ]);
  });

  it('does not add counterparty names to an own conversion', async () => {
    const createdAt = new Date('2026-08-01T07:05:00.000Z');
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 403,
            kind: 'CONVERSION',
            status: TransactionStatus.SUCCESS,
            amount_in: '100',
            asset_in: 'ESOM',
            amount_out: '1',
            asset_out: 'USDT_TRC20',
            createdAt,
            sender_customer_id: 7,
            receiver_customer_id: 7,
            sender_customer: {
              first_name: 'Максат',
              middle_name: null,
              last_name: 'Кыдыкеев',
            },
            receiver_customer: {
              first_name: 'Максат',
              middle_name: null,
              last_name: 'Кыдыкеев',
            },
          },
        ]),
      },
    };
    const service = makeService(prismaMock);

    const rows = await service.getHistory({} as any, 7);

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('recipient_full_name');
    expect(rows[0]).not.toHaveProperty('sender_full_name');
    expect(rows[0].type).toBe(TransactionType.CONVERSION);
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

  it('includes ledger-linked transactions in history lookup', async () => {
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = makeService(prismaMock);

    await service.getHistory({} as any, 7);

    expect(prismaMock.transaction.findMany).toHaveBeenCalledTimes(1);
    const query = prismaMock.transaction.findMany.mock.calls[0][0];
    expect(query.where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ledger_entries: { some: { customer_id: 7 } },
        }),
      ]),
    );
  });

  it('keeps a recent history period live when the app reuses to_time', async () => {
    const now = new Date('2026-08-12T12:00:00.000Z').getTime();
    const clientToTime = now - 3 * 60 * 60 * 1000;
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = makeService(prismaMock);

    try {
      await service.getHistory({ to_time: clientToTime } as any, 7);
    } finally {
      dateNow.mockRestore();
    }

    const query = prismaMock.transaction.findMany.mock.calls[0][0];
    expect(query.where.createdAt.lte).toBeUndefined();
  });

  it('keeps the exact upper bound for historical periods', async () => {
    const now = new Date('2026-08-12T12:00:00.000Z').getTime();
    const historicalToTime = new Date('2026-07-01T23:59:59.999Z').getTime();
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(now);
    const prismaMock = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({ address: '0xmy' }),
      },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = makeService(prismaMock);

    try {
      await service.getHistory({ to_time: historicalToTime } as any, 7);
    } finally {
      dateNow.mockRestore();
    }

    const query = prismaMock.transaction.findMany.mock.calls[0][0];
    expect(query.where.createdAt.lte.getTime()).toBe(historicalToTime);
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

    expect(createMany).toHaveBeenCalledTimes(2);
    const payload = createMany.mock.calls[0][0];
    expect(payload.data).toHaveLength(3);
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
    expect(payload.data[2]).toMatchObject({
      sequence: 3,
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

    expect(createMany).toHaveBeenCalledTimes(2);
    const payload = createMany.mock.calls[0][0];
    expect(payload.data).toHaveLength(3);
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
    expect(payload.data[2]).toMatchObject({
      sequence: 3,
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
          usd_buy_rate: '80',
          usd_sell_rate: '90',
          btc_trade_fee_pct: '0',
          eth_trade_fee_pct: '0',
          usdt_trade_fee_pct: '0',
        }),
        getAdmin: jest.fn().mockResolvedValue({
          bank_commission_central_bank_pct: '20',
          bank_commission_bank_pct: '40',
          bank_commission_partners_pct: '40',
        }),
      } as any,
      {} as any,
      {
        refreshAllBalancesForUser: jest.fn().mockResolvedValue(undefined),
      } as any,
      {} as any,
      {
        checkTransactionDetailed: jest
          .fn()
          .mockResolvedValue({ allowed: true }),
      } as any,
      {} as any,
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
      400,
    );
  });

  it('stores a failed transaction when ESOM to USDT blockchain transfer fails', async () => {
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
          address: '0x1111111111111111111111111111111111111111',
          private_key:
            '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          first_name: 'Test',
          middle_name: null,
          last_name: 'User',
        }),
      },
      tariffSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      userAssetBalance: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      transaction: {
        create: jest.fn().mockResolvedValue({ id: 777 }),
      },
      accountingPosting: {
        createMany: jest.fn().mockResolvedValue({ count: 6 }),
      },
    };

    const ethereumService = {
      getAddressFromPrivateKey: jest
        .fn()
        .mockReturnValue('0x1111111111111111111111111111111111111111'),
      validateAddress: jest.fn().mockReturnValue(true),
      generateAddress: jest.fn(),
      transferToFiat: jest
        .fn()
        .mockRejectedValue(new Error('smart contract exploded')),
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
          esom_som_conversion_fee_pct: '0',
          esom_som_conversion_fee_min: '0',
          usdt_trade_fee_pct: '10',
        }),
        getAdmin: jest.fn().mockResolvedValue({
          bank_commission_central_bank_pct: '20',
          bank_commission_bank_pct: '40',
          bank_commission_partners_pct: '40',
        }),
      } as any,
      {} as any,
      {
        refreshAllBalancesForUser: jest.fn().mockResolvedValue(undefined),
      } as any,
      {} as any,
      {
        checkTransactionDetailed: jest
          .fn()
          .mockResolvedValue({ allowed: true }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.convert(
        {
          asset_from: 'ESOM' as any,
          asset_to: 'USDT_TRC20' as any,
          amount_from: 100,
        },
        7,
      ),
    ).rejects.toThrow('Conversion failed. Transaction 777');

    expect(prismaMock.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: TransactionStatus.FAILED }),
      }),
    );
    expect(prismaMock.userAssetBalance.upsert).not.toHaveBeenCalled();
    expect(ethereumService.transferToFiat).toHaveBeenCalledWith(
      100,
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
  });
});
