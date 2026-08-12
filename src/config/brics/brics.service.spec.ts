import { ConfigService } from '@nestjs/config';
import { BricsService } from './brics.service';

describe('BricsService account lookup', () => {
  const makeService = () => {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          BRICS_API_ROOT: 'https://brics.test',
          INTEGRATION_API_ROOT: 'https://integration.test',
          CT_ACCOUNT_NO: 'test-account',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    return new BricsService(config);
  };

  const somAccount = {
    AccountNo: '1340000096186504',
    Balance: 100,
    CurrencyID: 417,
    CustomerID: 2566674,
  };

  it.each(['0508811888', '+0508811888'])(
    'retries local phone %s in +996 format after an empty result',
    async (phone) => {
      const service = makeService();
      const post = jest
        .fn()
        .mockResolvedValueOnce({ status: 200, data: [], headers: {} })
        .mockResolvedValueOnce({
          status: 200,
          data: [somAccount],
          headers: {},
        });
      (service as any).axiosInstance.post = post;

      const result = await service.findAccount(phone);

      expect(result).toMatchObject(somAccount);
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[0][1]).toEqual({ account: phone });
      expect(post.mock.calls[1][1]).toEqual({ account: '+996508811888' });
    },
  );

  it('does not retry when the original number is found', async () => {
    const service = makeService();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: [somAccount],
      headers: {},
    });
    (service as any).axiosInstance.post = post;

    await expect(service.findAccount('0508811888')).resolves.toMatchObject(
      somAccount,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not rewrite account numbers or existing +996 phones', async () => {
    const service = makeService();
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: [],
      headers: {},
    });
    (service as any).axiosInstance.post = post;

    await expect(service.findAccount('1340000096186504')).resolves.toBeUndefined();
    await expect(service.findAccount('+996508811888')).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
