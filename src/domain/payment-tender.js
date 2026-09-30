const centTolerance = 1e-7;

const methodMap = Object.freeze({
  efectivo: 'cash',
  tarjeta: 'card',
  transferencia: 'transfer',
  cash: 'cash',
  card: 'card',
  transfer: 'transfer',
});

/** Parse a non-negative MXN value into safe integer centavos. */
export function moneyToCents(value) {
  if (typeof value === 'string') {
    const input = value.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(input)) {
      throw new TypeError('amount must be a non-negative MXN amount with at most two decimals');
    }
    const [whole, fractional = ''] = input.split('.');
    const cents = Number(whole) * 100 + Number((fractional + '00').slice(0, 2));
    if (!Number.isSafeInteger(cents)) throw new RangeError('amount exceeds safe centavos');
    return cents;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('amount must be a finite non-negative MXN amount');
  }
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > centTolerance) {
    throw new RangeError('amount must have at most two decimal places and fit safe centavos');
  }
  return cents;
}

export function centsToMoney(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError('centavos must be a non-negative safe integer');
  return cents / 100;
}

function checkedSum(values) {
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(sum)) throw new RangeError('payment total exceeds safe centavos');
  return sum;
}

/**
 * Normalize entered tender into net payment records. Overpayment is returned
 * from cash rows only; non-cash rows are never reduced to fund change.
 */
export function calculateTender(totalDueCents, tenders, { tipCents = 0 } = {}) {
  if (!Number.isSafeInteger(totalDueCents) || totalDueCents < 1) {
    return { valid: false, error: 'El total debe ser positivo y estar expresado en centavos enteros.' };
  }
  if (!Number.isSafeInteger(tipCents) || tipCents < 0 || tipCents > totalDueCents) {
    return { valid: false, error: 'La propina debe ser un importe válido dentro del total.' };
  }
  if (!Array.isArray(tenders) || tenders.length === 0) {
    return { valid: false, error: 'Captura al menos un pago.' };
  }

  let entries;
  try {
    entries = tenders.map((tender) => {
      const method = methodMap[tender?.method];
      if (!method) throw new TypeError('unsupported payment method');
      return { id: tender.id, method, tenderedCents: moneyToCents(tender.amount) };
    });
  } catch (error) {
    return { valid: false, error: 'Revisa los importes: usa cantidades MXN no negativas con máximo dos decimales.' };
  }

  let tenderedCents;
  let cashCents;
  try {
    tenderedCents = checkedSum(entries.map((entry) => entry.tenderedCents));
    cashCents = checkedSum(entries.filter((entry) => entry.method === 'cash').map((entry) => entry.tenderedCents));
  } catch (error) {
    return { valid: false, error: 'La suma de importes excede el límite seguro de centavos.' };
  }
  const changeCents = Math.max(0, tenderedCents - totalDueCents);
  if (tenderedCents < totalDueCents) {
    return { valid: false, error: 'El monto capturado aún no cubre el total.', tenderedCents, remainingCents: totalDueCents - tenderedCents, changeCents: 0 };
  }
  if (changeCents > cashCents) {
    return { valid: false, error: 'El excedente solo puede devolverse desde el efectivo recibido.', tenderedCents, remainingCents: 0, changeCents };
  }

  let changeToDeduct = changeCents;
  const netEntries = entries.map((entry) => {
    const deduction = entry.method === 'cash' ? Math.min(changeToDeduct, entry.tenderedCents) : 0;
    changeToDeduct -= deduction;
    return { ...entry, netAmountCents: entry.tenderedCents - deduction, changeCents: deduction };
  });
  if (changeToDeduct !== 0 || netEntries.some((entry) => entry.netAmountCents < 0)) {
    return { valid: false, error: 'El cambio no puede exceder el efectivo recibido.', tenderedCents, remainingCents: 0, changeCents };
  }
  if (checkedSum(netEntries.map((entry) => entry.netAmountCents)) !== totalDueCents) {
    return { valid: false, error: 'La suma de pagos netos debe coincidir con el total.', tenderedCents, remainingCents: 0, changeCents };
  }

  let tipRemaining = tipCents;
  const payments = netEntries.map((entry) => {
    const assignedTip = Math.min(tipRemaining, entry.netAmountCents);
    tipRemaining -= assignedTip;
    return { ...entry, tipCents: assignedTip };
  });
  if (tipRemaining !== 0) return { valid: false, error: 'La propina no se pudo asignar a los pagos netos.' };

  return {
    valid: true,
    tenderedCents,
    netPaidCents: totalDueCents,
    remainingCents: 0,
    changeCents,
    payments,
  };
}

/** Read new centavo records exactly; preserve old amount-only history as recorded. */
export function paymentNetCents(payment) {
  if (Number.isSafeInteger(payment?.netAmountCents) && payment.netAmountCents >= 0) return payment.netAmountCents;
  if (Number.isSafeInteger(payment?.amountCents) && payment.amountCents >= 0) return payment.amountCents;
  try {
    return moneyToCents(payment?.amount);
  } catch {
    return null;
  }
}

export function paymentMethodTotalsCents(sales) {
  const totals = {};
  for (const sale of Array.isArray(sales) ? sales : []) {
    for (const payment of Array.isArray(sale?.payments) ? sale.payments : []) {
      const cents = paymentNetCents(payment);
      if (cents == null) continue;
      const label = payment.methodLabel || payment.method;
      totals[label] = (totals[label] || 0) + cents;
    }
  }
  return totals;
}
