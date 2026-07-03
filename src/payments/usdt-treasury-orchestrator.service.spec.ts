import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../config/crypto/crypto.service';
import { BricsService } from 'src/config/brics/brics.service';
import { UsdtTreasuryOrchestratorService } from './usdt-treasury-orchestrator.service';

describe('UsdtTreasuryOrchestratorService', () => {
  let service: UsdtTreasuryOrchestratorService;
  const prismaMock: any = {
    blockchainTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsdtTreasuryOrchestratorService,
        { provide: PrismaClient, useValue: prismaMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'USDT_RPC_URL') return 'http://127.0.0.1:8090';
              if (key === 'USDT_TOKEN_ADDRESS') {
                return 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
              }
              if (key === 'USDT_TREASURY_PRIVATE_KEY') {
                return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
              }
              return undefined;
            }),
          },
        },
        {
          provide: CryptoService,
          useValue: {
            trxAddressFromPrivateKey: jest.fn(() => 'TXYZ'),
          },
        },
        { provide: BricsService, useValue: {} },
      ],
    }).compile();

    service = module.get(UsdtTreasuryOrchestratorService);
    (service as any).getRuntime = jest.fn(() => ({
      rpcUrl: 'http://127.0.0.1:8090',
      tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      treasuryPrivateKey:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      treasuryAddress: 'TXYZ',
    }));
  });

  it('returns reserve snapshot even when chain balance and resources are unavailable', async () => {
    (service as any).getUsdtBalance = jest
      .fn()
      .mockRejectedValue(new Error('no contract'));
    (service as any).getTreasuryAccountSnapshot = jest
      .fn()
      .mockRejectedValue(new Error('rpc down'));

    const snapshot = await service.getTreasuryReserveSnapshot();

    expect(snapshot).toEqual({
      treasury_address: 'TXYZ',
      usdt_balance: 0,
      trx_balance: 0,
      energy_available: 0,
      bandwidth_available: 0,
      energy_spent_today: 0,
      energy_spent_total: 0,
      bandwidth_spent_today: 0,
      bandwidth_spent_total: 0,
      network_fee_trx_today: 0,
      network_fee_trx_total: 0,
    });
  });

  it('returns reserve snapshot fallback when runtime lookup fails', async () => {
    (service as any).getRuntime = jest.fn(() => {
      throw new Error('runtime missing');
    });

    const snapshot = await service.getTreasuryReserveSnapshot();

    expect(snapshot).toEqual({
      treasury_address: '',
      usdt_balance: 0,
      trx_balance: 0,
      energy_available: 0,
      bandwidth_available: 0,
      energy_spent_today: 0,
      energy_spent_total: 0,
      bandwidth_spent_today: 0,
      bandwidth_spent_total: 0,
      network_fee_trx_today: 0,
      network_fee_trx_total: 0,
    });
  });

  it('applies tariff fee to internal USDT transfers', async () => {
    const transactionCreate = jest.fn().mockResolvedValue({ id: 501 });
    const paymentOperationUpdate = jest.fn().mockResolvedValue({ id: 77 });
    const prismaTxMock = {
      transaction: {
        create: transactionCreate,
      },
      paymentOperation: {
        update: paymentOperationUpdate,
      },
    };

    prismaMock.customer = {
      findUnique: jest.fn().mockResolvedValue({
        tariff_category: 'K1',
        residency: 'RESIDENT',
      }),
    };
    prismaMock.tariffSetting = {
      findUnique: jest.fn().mockResolvedValue({
        percent_fee: '10',
        fixed_fee: '0',
      }),
    };
    prismaMock.$transaction = jest
      .fn()
      .mockImplementation(async (callback: any) => callback(prismaTxMock));

    (service as any).findOperationByIdempotencyKey = jest
      .fn()
      .mockResolvedValue(null);
    (service as any).createOperation = jest.fn().mockResolvedValue({
      id: 77,
      attempt_count: 0,
      payload: null,
      status: 'NEW',
    });
    (service as any).applyLedgerDelta = jest.fn().mockResolvedValue(undefined);
    (service as any).markFailed = jest.fn();

    const result = await service.processInternalTransfer({
      senderCustomerId: 1,
      receiverCustomerId: 2,
      amount: 100,
      senderAddress: 'Tsender',
      receiverAddress: 'Treceiver',
      idempotencyKey: 'transfer-1',
      payload: { source: 'spec' },
    });

    expect(result.transaction_id).toBe(501);
    expect(transactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount_in: '100',
          amount_out: '90',
          fee_amount: '10',
        }),
      }),
    );
    expect((service as any).applyLedgerDelta).toHaveBeenCalledWith(
      prismaTxMock,
      expect.objectContaining({
        customerId: 1,
        delta: -100,
      }),
    );
    expect((service as any).applyLedgerDelta).toHaveBeenCalledWith(
      prismaTxMock,
      expect.objectContaining({
        customerId: 2,
        delta: 90,
      }),
    );
  });
});
