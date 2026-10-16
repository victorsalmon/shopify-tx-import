import { describe, expect, it } from 'vitest';
import { applyBalanceTransaction, decimalToCents, orderToSalesRecord } from '../src/adapter.js';
import { ORDERS_UPDATED_QUERY } from '../src/poll.js';
import {
  makeBalanceTransaction,
  makeMultiTaxOrder,
  makeOrder,
  makeTaxedOrder,
} from './fixtures.js';

/** Sum the `taxLines[].priceSet` amounts of an order payload, in cents. */
function sumTaxLinesCents(order: Record<string, unknown>): number {
  const lines = order['taxLines'];
  if (!Array.isArray(lines)) throw new Error('fixture has no taxLines array');
  return lines.reduce((sum, line) => {
    const priceSet = (line as Record<string, unknown>)['priceSet'];
    const shopMoney = (priceSet as Record<string, unknown>)['shopMoney'] as {
      amount: string;
    };
    return sum + decimalToCents(shopMoney.amount);
  }, 0);
}

describe('taxed orders carry exact tax math', () => {
  it('maps a single-HST taxed order exactly ($200 + $26 HST = $226)', () => {
    const record = orderToSalesRecord(makeTaxedOrder());
    expect(record.externalId).toBe('#1003');
    expect(record.grossCents).toBe(20000);
    expect(record.taxCents).toBe(2600);
    expect(record.feeCents).toBeNull();
    expect(record.netCents).toBe(22600);
    expect(record.currency).toBe('CAD');
  });

  it('maps a multi-tax order exactly ($100 + $5 GST + $7 PST = $112)', () => {
    const record = orderToSalesRecord(makeMultiTaxOrder());
    expect(record.externalId).toBe('#1004');
    expect(record.grossCents).toBe(10000);
    expect(record.taxCents).toBe(1200);
    expect(record.netCents).toBe(11200);
  });

  it('taxCents always equals the sum of taxLines', () => {
    for (const order of [makeOrder(), makeTaxedOrder(), makeMultiTaxOrder()]) {
      const record = orderToSalesRecord(order);
      expect(record.taxCents).toBe(sumTaxLinesCents(order as Record<string, unknown>));
    }
  });

  it('the backfill query fetches taxLines for the cross-check', () => {
    expect(ORDERS_UPDATED_QUERY).toContain('taxLines');
    expect(ORDERS_UPDATED_QUERY).toContain('priceSet');
  });
});

describe('applyBalanceTransaction (per-order fee from payouts leg)', () => {
  it('fills feeCents and recomputes net on an associatedOrder GID match', () => {
    const record = orderToSalesRecord(makeOrder());
    const withFee = applyBalanceTransaction(record, makeBalanceTransaction());
    expect(withFee.feeCents).toBe(33);
    expect(withFee.netCents).toBe(11300 - 33);
    expect(record.feeCents).toBeNull(); // input untouched
  });

  it('matches a numeric order id against a GID associatedOrder', () => {
    const order = { ...makeOrder(), id: 6249512505633 };
    const record = orderToSalesRecord(order);
    const withFee = applyBalanceTransaction(record, makeBalanceTransaction());
    expect(withFee.feeCents).toBe(33);
  });

  it('matches by order name when ids differ in form', () => {
    const order = makeOrder({ id: 'gid://shopify/Order/999', name: '#1001' });
    const record = orderToSalesRecord(order);
    const tx = makeBalanceTransaction({ orderId: 'gid://shopify/Order/111', orderName: '#1001' });
    expect(applyBalanceTransaction(record, tx).feeCents).toBe(33);
  });

  it('accepts the MoneySet fee wrapper', () => {
    const withFee = applyBalanceTransaction(
      orderToSalesRecord(makeOrder()),
      makeBalanceTransaction({ moneySetFee: true }),
    );
    expect(withFee.feeCents).toBe(33);
  });

  it('recomputes net against refunds too', () => {
    const order = makeOrder({ id: 'gid://shopify/Order/7', name: '#1002', refunded: '20.00' });
    const record = orderToSalesRecord(order);
    const tx = makeBalanceTransaction({ orderId: 'gid://shopify/Order/7', orderName: '#1002' });
    const withFee = applyBalanceTransaction(record, tx);
    expect(withFee.netCents).toBe(10000 + 1300 - 2000 - 33);
  });

  it('leaves the record unchanged for a different order', () => {
    const record = orderToSalesRecord(makeOrder());
    const tx = makeBalanceTransaction({ orderId: 'gid://shopify/Order/1', orderName: '#9999' });
    const result = applyBalanceTransaction(record, tx);
    expect(result.feeCents).toBeNull();
    expect(result.netCents).toBe(record.netCents);
  });

  it('leaves the record unchanged with no associatedOrder', () => {
    const record = orderToSalesRecord(makeOrder());
    const result = applyBalanceTransaction(record, makeBalanceTransaction({ dropAssociatedOrder: true }));
    expect(result).toEqual(record);
  });

  it('treats test-mode transactions as fee-less (no real fee exists)', () => {
    const record = orderToSalesRecord(makeOrder());
    const result = applyBalanceTransaction(record, makeBalanceTransaction({ test: true }));
    expect(result.feeCents).toBeNull();
    expect(result).toEqual(record);
  });

  it('keeps feeCents null for non-Shopify-Payments gateways', () => {
    const record = orderToSalesRecord(makeOrder());
    for (const gateway of ['paypal', 'stripe']) {
      expect(applyBalanceTransaction(record, makeBalanceTransaction(), gateway).feeCents).toBeNull();
      expect(
        applyBalanceTransaction(record, makeBalanceTransaction({ gateway })).feeCents,
      ).toBeNull();
    }
  });

  it('leaves the record unchanged when the transaction carries no fee', () => {
    const record = orderToSalesRecord(makeOrder());
    expect(applyBalanceTransaction(record, makeBalanceTransaction({ dropFee: true }))).toEqual(
      record,
    );
  });

  it('rejects a non-object transaction instead of guessing', () => {
    const record = orderToSalesRecord(makeOrder());
    expect(() => applyBalanceTransaction(record, null)).toThrow();
  });
});
