import { HttpException, HttpStatus } from '@nestjs/common';

export type PaymentOperation = 'transfer' | 'conversion';

function extractMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      if (Array.isArray(message)) return message.join('. ');
      if (typeof message === 'string') return message;
    }
  }
  return error instanceof Error ? error.message : String(error ?? '');
}

function antifraudMessage(message: string): string {
  const normalized = message.toUpperCase();
  let reason = 'операция требует дополнительной проверки';

  if (normalized.includes('EXTERNAL_WALLET_BLOCKLIST')) {
    reason = 'кошелёк отправителя находится в AML-списке риска';
  } else if (
    normalized.includes('FIAT_ANY_GE_1M') ||
    normalized.includes('ONE_TIME_GE_8M')
  ) {
    reason = 'сумма операции превышает установленный лимит';
  } else if (normalized.includes('FREQUENT_OPS')) {
    reason = 'превышена допустимая частота операций';
  } else if (normalized.includes('WITHDRAW_AFTER_LARGE_INFLOW')) {
    reason = 'вывод после крупного поступления требует проверки';
  } else if (normalized.includes('SPLITTING')) {
    reason = 'обнаружены признаки дробления переводов';
  } else if (
    normalized.includes('THIRD_PARTY_DEPOSITS') ||
    normalized.includes('MANY_SENDERS_TO_ONE')
  ) {
    reason = 'обнаружены поступления от большого количества отправителей';
  } else if (normalized.includes('AFTER_INACTIVITY')) {
    reason = 'операция после длительной неактивности требует проверки';
  }

  return `Перевод заблокирован системой финансового контроля: ${reason}. Обратитесь в поддержку.`;
}

export function paymentErrorMessage(
  error: unknown,
  operation: PaymentOperation,
  recipientType?: 'phone' | 'wallet',
): string {
  const raw = extractMessage(error);
  const message = raw.toLowerCase();

  if (
    message.includes('rejected by anti-fraud') ||
    message.includes('rejected by antifraud') ||
    message.includes('aml:')
  ) {
    return antifraudMessage(raw);
  }
  if (
    message.includes('recipient not found') ||
    message.includes('recipient information not found')
  ) {
    return recipientType === 'phone'
      ? 'Не существует получателя с таким номером телефона.'
      : 'Не существует получателя с таким адресом кошелька.';
  }
  if (
    message.includes('wallet address recipient not found') ||
    message.includes('unknown usdt deposit recipient')
  ) {
    return 'Не существует получателя с таким адресом кошелька.';
  }
  if (
    message.includes('sender and recipient') ||
    message.includes('must be different')
  ) {
    return 'Нельзя перевести средства самому себе.';
  }
  if (
    message.includes('user is blocked') ||
    message.includes('profile is blocked')
  ) {
    return 'Операция недоступна: ваш профиль заблокирован. Обратитесь в поддержку.';
  }
  if (
    message.includes('insufficient') ||
    message.includes('недостаточно средств')
  ) {
    return 'Недостаточно средств для выполнения операции с учётом комиссии.';
  }
  if (message.includes('amount below minimum')) {
    return 'Сумма меньше минимально допустимой для этой операции.';
  }
  if (
    message.includes('amount must be positive') ||
    message.includes('amount must not be less than') ||
    message.includes('amount must be a number')
  ) {
    return 'Введите корректную сумму больше нуля.';
  }
  if (
    message.includes('either address or phone_number') ||
    message.includes('specify either phone_number or address')
  ) {
    return 'Укажите номер телефона или адрес кошелька получателя.';
  }
  if (
    message.includes('invalid address') ||
    message.includes('invalid tron') ||
    message.includes('invalid ethereum')
  ) {
    return 'Указан некорректный адрес кошелька.';
  }
  if (
    message.includes('customer not found') ||
    message.includes('sender not found') ||
    message.includes('authentication failed')
  ) {
    return 'Не удалось получить данные пользователя. Выполните вход повторно или обратитесь в поддержку.';
  }
  if (
    message.includes('1723') ||
    (message.includes('рыночный курс') && message.includes('отсутствует'))
  ) {
    return 'Перевод в СОМ временно недоступен: в банковской системе не настроен рыночный курс. Обратитесь в поддержку.';
  }
  if (message.includes('1428') || message.includes('счетами одного типа')) {
    return 'Перевод между выбранными счетами недоступен. Обратитесь в поддержку.';
  }
  if (
    message.includes('usd buy rate') ||
    message.includes('usd sell rate') ||
    message.includes('exchange rate') ||
    message.includes('курс не настроен')
  ) {
    return 'Конвертация временно недоступна: курс валют не настроен. Обратитесь в поддержку.';
  }
  if (
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('network error')
  ) {
    return 'Платёжная система не ответила вовремя. Проверьте историю и баланс перед повторной попыткой.';
  }
  if (
    message.includes('brics transaction failed') ||
    message.includes('som transfer failed') ||
    message.includes('ethereum transaction failed') ||
    message.includes('ethereum fee transaction failed') ||
    message.includes('trc20 broadcast') ||
    message.includes('tapos') ||
    message.includes('transaction failed') ||
    message.includes('convert failed')
  ) {
    return operation === 'conversion'
      ? 'Конвертация не выполнена из-за ошибки платёжной системы. Проверьте историю и баланс, затем повторите попытку или обратитесь в поддержку.'
      : 'Перевод не выполнен из-за ошибки платёжной системы. Проверьте историю и баланс, затем повторите попытку или обратитесь в поддержку.';
  }

  return operation === 'conversion'
    ? 'Не удалось выполнить конвертацию. Проверьте данные и повторите попытку. Если ошибка повторится, обратитесь в поддержку.'
    : 'Не удалось выполнить перевод. Проверьте данные и повторите попытку. Если ошибка повторится, обратитесь в поддержку.';
}

export function paymentHttpException(
  error: unknown,
  operation: PaymentOperation,
  recipientType?: 'phone' | 'wallet',
): HttpException {
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  return new HttpException(
    {
      statusCode: status,
      message: paymentErrorMessage(error, operation, recipientType),
      error: status >= 500 ? 'Internal Server Error' : 'Bad Request',
    },
    status,
  );
}
