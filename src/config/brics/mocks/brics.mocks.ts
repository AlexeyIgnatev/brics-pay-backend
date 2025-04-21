export const mockLoginResponse = {
  status: 200,
  headers: {
    'set-cookie': ['ASP.NET_SessionId=mock_session_id'],
  },
};

export const mockCustomerInfo = {
  CustomerID: 12345,
  EMail: 'test@example.com',
  ContactPhone1: '+996555123456',
  CustomerName: 'Иван',
  Surname: 'Иванов',
  Otchestvo: 'Иванович',
};

export const mockAccountsResponse = {
  data: [
    {
      AccountNo: '1234567890',
      CurrencyID: 417,
      CustomerID: 12345,
      Balance: 1000.5,
    },
  ],
};
