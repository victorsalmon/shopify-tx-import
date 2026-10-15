import { describe, expect, it } from 'vitest';
import {
  applyPayoutSummary,
  decimalToCents,
  isShopifyPaymentsGateway,
  orderToSalesRecord,
  shopifyOrderIdempotencyKey,
} from '../src/adapter.js';
import { makeOrder, makePayoutSummary, makePayoutSummaryMoneySet, makeRefundedOrder } from './fixtures.js';

describe('decimalToCents (the single conversion edge)', () => {
  it('converts decimal strings to cents', () => {
    expect(decimalToCents('19.99')).toBe(1999);
    expect(decimalToCents('113.00')).toBe(11300);
    expect(decimalToCents('0.00')).toBe(0);
  });

  it('absorbs binary float error via Math.round', () => {
    expect(decimalToCents(0.07)).toBe(7);
    expect(decimalToCents('0.1')).toBe(10);
    expect(decimalToCents('2.675')).toBe(268); // banker's neighbours round half up
  });

  it('rejects non-numeric input instead of guessing', () => {
    expect(() => decimalToCents('')).toThrow();
    expect(() => decimalToCents('abc')).toThrow();
    expect(() => decimalToCents(Number.NaN)).toThrow();
    expect(() => decimalToCents(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('orderToSalesRecord happy path', () => {
  it('maps name/date/totals/status/currency', () => {
    const record = orderToSalesRecord(makeOrder());
    expect(record.externalId).toBe('#1001');
    expect(record.date).toBe('2026-09-15T12:34:56.000Z');
    expect(record.grossCents).toBe(10000); // 113.00 total minus 13.00 tax
    expect(record.taxCents).toBe(1300);
    expect(record.feeCents).toBeNull();
    expect(record.netCents).toBe(11300);
    expect(record.currency).toBe('CAD');
    expect(record.refundedCents).toBe(0);
    expect(record.status).toBe('paid');
    expect(record.provider).toBe('shopify');
    expect(record.rawJson).toBeDefined();
  });

  it('normalizes every displayFinancialStatus value', () => {
    const cases: Array<[string | undefined, string]> = [
      ['PENDING', 'pending'],
      ['AUTHORIZED', 'authorized'],
      ['PARTIALLY_PAID', 'partially_paid'],
      ['PAID', 'paid'],
      ['PARTIALLY_REFUNDED', 'partially_refunded'],
      ['REFUNDED', 'refunded'],
      ['VOIDED', 'voided'],
      ['SOMETHING_NEW', 'unknown'],
      [undefined, 'unknown'],
    ];
    for (const [input, expected] of cases) {
      const order = makeOrder({ status: input as string });
      if (input === undefined) delete (order as Record<string, unknown>)['displayFinancialStatus'];
      expect(orderToSalesRecord(order).status).toBe(expected);
    }
  });

  it('fails loud on missing name, date, totals, or currency', () => {
    expect(() => orderToSalesRecord(null)).toThrow();
    expect(() => orderToSalesRecord({ ...makeOrder(), name: '' })).toThrow();
    const noTotals = makeOrder();
    delete (noTotals as Record<string, unknown>)['currentTotalPriceSet'];
    expect(() => orderToSalesRecord(noTotals)).toThrow();
    const noTax = makeOrder();
    delete (noTax as Record<string, unknown>)['currentTotalTaxSet'];
    expect(() => orderToSalesRecord(noTax)).toThrow();
    expect(() => orderToSalesRecord({ ...makeOrder(), processedAt: 'not-a-date' })).toThrow();
  });
});

describe('orderToSalesRecord refund path', () => {
  it('subtracts refunds from net and reports status', () => {
    const record = orderToSalesRecord(makeRefundedOrder());
    expect(record.externalId).toBe('#1002');
    expect(record.grossCents).toBe(10000);
    expect(record.taxCents).toBe(1300);
    expect(record.refundedCents).toBe(2000);
    expect(record.netCents).toBe(9300);
    expect(record.status).toBe('partially_refunded');
  });

  it('treats a missing refund set as zero refunds', () => {
    expect(orderToSalesRecord(makeOrder({ dropRefunded: true })).refundedCents).toBe(0);
  });
});

describe('applyPayoutSummary', () => {
  it('fills feeCents and recomputes net for Shopify Payments', () => {
    const record = orderToSalesRecord(makeOrder());
    const withFee = applyPayoutSummary(record, makePayoutSummary(), 'shopify_payments');
    expect(withFee.feeCents).toBe(33);
    expect(withFee.netCents).toBe(11300 - 33);
    expect(record.feeCents).toBeNull(); // input untouched
  });

  it('accepts the MoneySet fee wrapper and an omitted gateway', () => {
    const withFee = applyPayoutSummary(orderToSalesRecord(makeOrder()), makePayoutSummaryMoneySet());
    expect(withFee.feeCents).toBe(33);
    expect(withFee.netCents).toBe(11300 - 33);
  });

  it('keeps feeCents null for non-Shopify-Payments gateways', () => {
    for (const gateway of ['paypal', 'stripe', 'manual', 'cash_on_delivery']) {
      const record = orderToSalesRecord(makeOrder());
      const result = applyPayoutSummary(record, makePayoutSummary(), gateway);
      expect(result.feeCents).toBeNull();
      expect(result.netCents).toBe(record.netCents);
    }
  });

  it('honours a non-Shopify gateway stamped on the summary itself', () => {
    const result = applyPayoutSummary(orderToSalesRecord(makeOrder()), {
      ...makePayoutSummary(),
      gateway: 'paypal',
    });
    expect(result.feeCents).toBeNull();
  });

  it('leaves the record unchanged when the summary carries no fee', () => {
    const record = orderToSalesRecord(makeOrder());
    expect(applyPayoutSummary(record, { id: 'x' })).toEqual(record);
  });

  it('recognizes Shopify Payments spellings', () => {
    expect(isShopifyPaymentsGateway('shopify_payments')).toBe(true);
    expect(isShopifyPaymentsGateway('Shopify Payments')).toBe(true);
    expect(isShopifyPaymentsGateway('SHOPIFY-PAYMENTS')).toBe(true);
    expect(isShopifyPaymentsGateway('paypal')).toBe(false);
  });
});

describe('shopifyOrderIdempotencyKey', () => {
  it('is stable and namespaced', () => {
    expect(shopifyOrderIdempotencyKey(6249512505633)).toBe('shopify_order:6249512505633');
    expect(shopifyOrderIdempotencyKey(6249512505633)).toBe(shopifyOrderIdempotencyKey(6249512505633));
    expect(shopifyOrderIdempotencyKey('gid://shopify/Order/6249512505633')).toBe(
      'shopify_order:gid://shopify/Order/6249512505633',
    );
  });

  it('rejects empty ids', () => {
    expect(() => shopifyOrderIdempotencyKey('')).toThrow();
    expect(() => shopifyOrderIdempotencyKey('   ')).toThrow();
    expect(() => shopifyOrderIdempotencyKey(Number.NaN)).toThrow();
  });
});
