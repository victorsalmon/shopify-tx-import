/**
 * Realistic Admin API payloads shared by the test suite.
 * Amounts mirror a 13% HST Ontario order: $100.00 + $13.00 tax = $113.00.
 */

function money(amount: string, currencyCode = 'CAD') {
  return { shopMoney: { amount, currencyCode } };
}

export interface FixtureOverrides {
  name?: string;
  processedAt?: string;
  total?: string;
  tax?: string;
  refunded?: string;
  status?: string;
  currency?: string;
  dropRefunded?: boolean;
}

export function makeOrder(overrides: FixtureOverrides = {}) {
  const currency = overrides.currency ?? 'CAD';
  const order: Record<string, unknown> = {
    id: 'gid://shopify/Order/6249512505633',
    name: overrides.name ?? '#1001',
    processedAt: overrides.processedAt ?? '2026-09-15T12:34:56Z',
    currencyCode: currency,
    currentTotalPriceSet: money(overrides.total ?? '113.00', currency),
    currentTotalTaxSet: money(overrides.tax ?? '13.00', currency),
    displayFinancialStatus: overrides.status ?? 'PAID',
    taxLines: [
      { title: 'HST', rate: 0.13, priceSet: money(overrides.tax ?? '13.00', currency) },
    ],
  };
  if (!overrides.dropRefunded) {
    order['totalRefundedSet'] = money(overrides.refunded ?? '0.00', currency);
  }
  return order;
}

/** Partially-refunded order: $20.00 of $113.00 refunded. */
export function makeRefundedOrder() {
  return makeOrder({ name: '#1002', refunded: '20.00', status: 'PARTIALLY_REFUNDED' });
}

/** Shopify Payments payout summary carrying a $0.33 transaction fee. */
export function makePayoutSummary() {
  return {
    id: 'gid://shopify/ShopifyPaymentsPayout/987',
    status: 'paid',
    chargesFee: { amount: '0.33', currencyCode: 'CAD' },
  };
}

/** Same fee in the MoneySet wrapper some summary fields use. */
export function makePayoutSummaryMoneySet() {
  return {
    chargesFee: money('0.33'),
  };
}
