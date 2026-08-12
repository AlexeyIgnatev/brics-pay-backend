import { UsersService } from './users.service';

describe('UsersService wallet rates', () => {
  it('returns raw configured rates without embedding tariff fees', async () => {
    const customer = {
      customer_id: 7,
      address: '0x1111111111111111111111111111111111111111',
      private_key:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      phone: '+996508811888',
    };
    const prisma = {
      customer: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(customer),
      },
      userAssetBalance: {
        findUnique: jest.fn(({ where }: any) => {
          const asset = where.customer_id_asset.asset;
          return Promise.resolve({ balance: asset === 'USDT_TRC20' ? '5' : '10' });
        }),
      },
    };
    const settingsService = {
      get: jest.fn().mockResolvedValue({
        esom_per_usd: '80',
        usd_buy_rate: '80',
        usd_sell_rate: '90',
      }),
      getTariffs: jest.fn(),
    };
    const ethereumService = {
      getAddressFromPrivateKey: jest.fn().mockReturnValue(customer.address),
      validateAddress: jest.fn().mockReturnValue(true),
      getEsomBalance: jest.fn().mockResolvedValue(10),
    };
    const service = new UsersService(
      {
        resolveCustomerSomAccount: jest.fn().mockResolvedValue({ Balance: 10 }),
      } as any,
      prisma as any,
      ethereumService as any,
      {
        trxAddressFromPrivateKey: jest.fn().mockReturnValue('TUsdtWallet'),
      } as any,
      settingsService as any,
      {} as any,
    );

    const wallets = await service.getUserWallets({
      customer_id: 7,
      first_name: 'Test',
      middle_name: '',
      last_name: 'User',
      phone: customer.phone,
      email: 'test@example.com',
    });

    expect(wallets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'SOM', buy_rate: 1, sell_rate: 1 }),
        expect.objectContaining({ currency: 'ESOM', buy_rate: 1, sell_rate: 1 }),
        expect.objectContaining({
          currency: 'USDT_TRC20',
          buy_rate: 80,
          sell_rate: 90,
        }),
      ]),
    );
    expect(settingsService.getTariffs).not.toHaveBeenCalled();
  });
});
