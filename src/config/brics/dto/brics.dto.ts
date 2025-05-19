export class BricsAccountDto {
  AccountNo: string;
  Balance: number;
  CurrencyID: number;
  CustomerID: number;
}

export class BricsCustomerDto {
  CustomerID: number;
  EMail: string;
  ContactPhone1: string;
  CustomerName: string;
  Surname: string;
  Otchestvo: string;
  SurnameTranslit: string;
  CustomerNameTranslit: string;
  OtchestvoTranslit: string;
}
