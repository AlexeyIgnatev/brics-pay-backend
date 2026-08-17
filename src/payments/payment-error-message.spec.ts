import { BadRequestException } from '@nestjs/common';
import { paymentErrorMessage } from './payment-error-message';

describe('paymentErrorMessage', () => {
  it('explains a missing phone recipient', () => {
    expect(
      paymentErrorMessage(
        new BadRequestException('Recipient not found'),
        'transfer',
        'phone',
      ),
    ).toBe('Не существует получателя с таким номером телефона.');
  });

  it('explains an antifraud amount block', () => {
    expect(
      paymentErrorMessage(
        new BadRequestException('Rejected by anti-fraud (rule=FIAT_ANY_GE_1M)'),
        'transfer',
      ),
    ).toContain('сумма операции превышает установленный лимит');
  });

  it('does not expose blockchain details', () => {
    const result = paymentErrorMessage(
      new BadRequestException('TRC20 broadcast failed: TAPOS_ERROR deadbeef'),
      'transfer',
    );
    expect(result).toContain('ошибки платёжной системы');
    expect(result).not.toContain('TAPOS');
  });

  it('explains insufficient funds', () => {
    expect(
      paymentErrorMessage(
        new BadRequestException('Insufficient balance including fee'),
        'transfer',
      ),
    ).toBe('Недостаточно средств для выполнения операции с учётом комиссии.');
  });
});
