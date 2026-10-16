/**
 * Realistic Admin API payloads shared by the test suite.
 * Amounts mirror a 13% HST Ontario order: $100.00 + $13.00 tax = $113.00.
 */

function money(amount: string, currencyCode = 'CAD') {
  return { shopMoney: { amount, currencyCode } };
}

export interface FixtureOverrides {
  id?: string;
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
    id: overrides.id ?? 'gid://shopify/Order/6249512505633',
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

/**
 * Taxed order: $200.00 + $26.00 HST (13%) = $226.00.
 * Mirrors a live taxed pull (order numbers/totals only, never PII).
 */
export function makeTaxedOrder() {
  return makeOrder({
    id: 'gid://shopify/Order/6249512505700',
    name: '#1003',
    processedAt: '2026-10-01T10:00:00Z',
    total: '226.00',
    tax: '26.00',
    status: 'PAID',
  });
}

/**
 * Multi-tax order: $100.00 + GST $5.00 (5%) + PST $7.00 (7%) = $112.00.
 * Proves `taxCents` equals the SUM of `taxLines`, not just a single line.
 */
export function makeMultiTaxOrder() {
  const currency = 'CAD';
  return {
    id: 'gid://shopify/Order/6249512505701',
    name: '#1004',
    processedAt: '2026-10-01T11:00:00Z',
    currencyCode: currency,
    currentTotalPriceSet: money('112.00', currency),
    currentTotalTaxSet: money('12.00', currency),
    totalRefundedSet: money('0.00', currency),
    displayFinancialStatus: 'PAID',
    taxLines: [
      { title: 'GST', rate: 0.05, priceSet: money('5.00', currency) },
      { title: 'PST', rate: 0.07, priceSet: money('7.00', currency) },
    ],
  };
}

export interface BalanceTransactionOverrides {
  orderId?: string;
  orderName?: string;
  fee?: string;
  test?: boolean;
  gateway?: string;
  dropAssociatedOrder?: boolean;
  dropFee?: boolean;
  moneySetFee?: boolean;
}

/**
 * Shopify Payments balance transaction for an order charge.
 * Shape mirrors `ShopifyPaymentsBalanceTransaction`:
 * `fee` (MoneyV2) + `associatedOrder { id name }` + `test` flag.
 */
export function makeBalanceTransaction(overrides: BalanceTransactionOverrides = {}) {
  const tx: Record<string, unknown> = {
    id: 'gid://shopify/ShopifyPaymentsBalanceTransaction/1001',
    type: 'charge',
    test: overrides.test ?? false,
    amount: { amount: '113.00', currencyCode: 'CAD' },
    net: { amount: '112.67', currencyCode: 'CAD' },
  };
  if (!overrides.dropAssociatedOrder) {
    tx['associatedOrder'] = {
      id: overrides.orderId ?? 'gid://shopify/Order/6249512505633',
      name: overrides.orderName ?? '#1001',
    };
  }
  if (!overrides.dropFee) {
    tx['fee'] = overrides.moneySetFee
      ? money(overrides.fee ?? '0.33')
      : { amount: overrides.fee ?? '0.33', currencyCode: 'CAD' };
  }
  if (overrides.gateway !== undefined) {
    tx['gateway'] = overrides.gateway;
  }
  return tx;
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
