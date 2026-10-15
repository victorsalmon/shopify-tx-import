// Runnable example: `npm run build && node examples/basic.mjs` (no network, no credentials).
import {
  applyPayoutSummary,
  orderToSalesRecord,
  shopifyOrderIdempotencyKey,
} from '../dist/index.js';

const order = {
  id: 'gid://shopify/Order/6249512505633',
  name: '#1001',
  processedAt: '2026-09-15T12:34:56Z',
  currentTotalPriceSet: { shopMoney: { amount: '113.00', currencyCode: 'CAD' } },
  currentTotalTaxSet: { shopMoney: { amount: '13.00', currencyCode: 'CAD' } },
  totalRefundedSet: { shopMoney: { amount: '0.00', currencyCode: 'CAD' } },
  displayFinancialStatus: 'PAID',
};

const record = orderToSalesRecord(order);
console.log('sales record:', record);
console.log('idempotency key:', shopifyOrderIdempotencyKey(6249512505633));

const withFee = applyPayoutSummary(
  record,
  { chargesFee: { amount: '0.33', currencyCode: 'CAD' } },
  'shopify_payments',
);
console.log('with Shopify Payments fee:', withFee);
