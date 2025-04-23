export const mockTokenBalance = '1000000000000000000'; // 1 ESOM в wei

export const mockContractResponse = {
  methods: {
    balanceOf: (address: string) => ({
      call: async () => '1000000000000000000', // 1 токен в wei
    }),
    transferFromFiat: (address: string, amount: bigint) => ({
      call: async () => true,
    }),
    transferToFiat: (address: string, amount: bigint) => ({
      call: async () => true,
    }),
    transfer: (address: string, amount: bigint) => ({
      call: async () => true,
    }),
  },
};

export const mockTransactionReceipt = {
  status: BigInt(1),
  transactionHash: '0x123...',
  blockHash: '0x456...',
  blockNumber: 12345,
  gasUsed: '1000000',
};
