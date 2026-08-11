import { SettingsService } from './settings.service';

describe('SettingsService tariffs', () => {
  it('returns the SOM user-transfer tariff from payments/fees source', async () => {
    const prisma = {
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          tariff_category: 'K1',
          residency: 'RESIDENT',
        }),
      },
      tariffSetting: {
        findMany: jest.fn().mockResolvedValue([
          {
            category: 'K1',
            residency: 'RESIDENT',
            operation: 'WALLET_TRANSFER_SOM',
            percent_fee: '1.5',
            fixed_fee: '0',
          },
        ]),
      },
    };
    const service = new SettingsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.getTariffsForCustomer(42);

    expect(prisma.tariffSetting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operation: {
            in: expect.arrayContaining(['WALLET_TRANSFER_SOM']),
          },
        }),
      }),
    );
    expect(result).toContainEqual({
      category: 'K1',
      residency: 'RESIDENT',
      operation: 'WALLET_TRANSFER_SOM',
      percent_fee: '1.5',
      fixed_fee: '0',
    });
  });
});
