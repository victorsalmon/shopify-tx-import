import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyPayoutSummary, orderToSalesRecord } from '../src/adapter.js';

/**
 * Money invariant: grossCents + taxCents - refundedCents - (feeCents ?? 0) === netCents
 * for every record the adapter produces — before AND after a payout summary.
 */
describe('money invariant', () => {
  const cents = (max: number) => fc.integer({ min: 0, max });
  const decimalOf = (c: number) => (c / 100).toFixed(2);

  const orderArb = fc
    .record({
      gross: cents(100_000),
      tax: cents(20_000),
      refunded: cents(50_000),
      currency: fc.constantFrom('CAD', 'USD'),
      status: fc.constantFrom('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PENDING'),
    })
    .map(({ gross, tax, refunded, currency, status }) => ({
      node: {
        id: 1,
        name: '#1',
        processedAt: '2026-09-15T12:00:00Z',
        currentTotalPriceSet: { shopMoney: { amount: decimalOf(gross + tax), currencyCode: currency } },
        currentTotalTaxSet: { shopMoney: { amount: decimalOf(tax), currencyCode: currency } },
        totalRefundedSet: {
          shopMoney: { amount: decimalOf(Math.min(refunded, gross + tax)), currencyCode: currency },
        },
        displayFinancialStatus: status,
      },
      refundedCapped: Math.min(refunded, gross + tax),
    }));

  function checkInvariant(record: {
    grossCents: number;
    taxCents: number;
    refundedCents: number;
    feeCents: number | null;
    netCents: number;
  }): void {
    expect(record.grossCents + record.taxCents - record.refundedCents - (record.feeCents ?? 0)).toBe(
      record.netCents,
    );
  }

  it('holds for mapped orders across generated amounts', () => {
    fc.assert(
      fc.property(orderArb, ({ node }) => {
        checkInvariant(orderToSalesRecord(node));
      }),
      { numRuns: 250 },
    );
  });

  it('holds after applying a payout summary (or leaving a non-Shopify gateway alone)', () => {
    fc.assert(
      fc.property(
        orderArb,
        cents(500),
        fc.constantFrom('shopify_payments', 'paypal'),
        ({ node }, feeCents, gateway) => {
          const record = orderToSalesRecord(node);
          const summary = { chargesFee: { amount: decimalOf(feeCents), currencyCode: 'CAD' } };
          checkInvariant(applyPayoutSummary(record, summary, gateway));
        },
      ),
      { numRuns: 250 },
    );
  });
});
