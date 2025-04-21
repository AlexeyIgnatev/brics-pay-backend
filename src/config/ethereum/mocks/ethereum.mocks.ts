export const mockTokenBalance = '1000000000000000000'; // 1 ESOM в wei

export const mockContractResponse = {
  methods: {
    balanceOf: (address: string) => ({
      call: async () => mockTokenBalance,
    }),
  },
};
