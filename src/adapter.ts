/**
 * Pure order → sales-record adapter. No I/O, no network, no clock.
 *
 * Money rule: this module is the ONLY place Shopify decimal amount strings
 * convert to integer cents, via {@link decimalToCents} (`Math.round(n * 100)`).
 * Everything downstream works in cents.
 */

import type {
  SalesRecord,
  ShopifyMoneySet,
  ShopifyMoneyV2,
  ShopifySalesStatus,
} from './types.js';

/**
 * Convert a Shopify decimal amount (`"19.99"`, `"0.1"`, `19.99`) to integer
 * cents. `Math.round` absorbs binary float error (`0.07 * 100` is
 * `7.000000000000001`). Throws on non-numeric input — fail loud, never guess.
 */
export function decimalToCents(value: string | number): number {
  if (typeof value === 'string' && value.trim() === '') {
    throw new Error('shopify-tx-import: invalid money amount (blank string)');
  }
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`shopify-tx-import: invalid money amount ${JSON.stringify(value)}`);
  }
  return Math.round(n * 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function moneyV2ToCents(value: unknown, field: string): number {
  if (!isRecord(value)) {
    throw new Error(`shopify-tx-import: ${field} must be a MoneyV2 or MoneySet object`);
  }
  // Accept both MoneyV2 ({ amount, currencyCode }) and MoneySet ({ shopMoney }).
  const inner: unknown =
    'shopMoney' in value ? (value as { shopMoney: unknown }).shopMoney : value;
  if (!isRecord(inner) || (typeof inner['amount'] !== 'string' && typeof inner['amount'] !== 'number')) {
    throw new Error(`shopify-tx-import: ${field} has no usable amount`);
  }
  return decimalToCents(inner['amount'] as string | number);
}

function moneySetCurrency(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const shop = (value as { shopMoney?: unknown }).shopMoney;
  if (!isRecord(shop) || typeof shop['currencyCode'] !== 'string') return null;
  return shop['currencyCode'] as string;
}

const STATUS_MAP: Record<string, ShopifySalesStatus> = {
  PENDING: 'pending',
  AUTHORIZED: 'authorized',
  PARTIALLY_PAID: 'partially_paid',
  PAID: 'paid',
  PARTIALLY_REFUNDED: 'partially_refunded',
  REFUNDED: 'refunded',
  VOIDED: 'voided',
};

function normalizeStatus(value: unknown): ShopifySalesStatus {
  if (typeof value !== 'string') return 'unknown';
  return STATUS_MAP[value.trim().toUpperCase()] ?? 'unknown';
}

/**
 * Map an Admin API Order payload (GraphQL node or REST order object with the
 * same fields) to a {@link SalesRecord}.
 *
 * - `externalId` = order `name` (e.g. `#1001`)
 * - `date` = `processedAt` (ISO)
 * - `grossCents` = `currentTotalPriceSet` minus `currentTotalTaxSet`
 *   (`currentTotalPriceSet` is tax-inclusive)
 * - `taxCents` = `currentTotalTaxSet` (equals the sum of `taxLines`)
 * - `refundedCents` = `totalRefundedSet` (0 when absent)
 * - `netCents` = gross + tax − refunded − (fee ?? 0); fee is `null` here, so
 *   this is the pre-fee net — {@link applyPayoutSummary} recomputes it once
 *   fee data exists.
 */
export function orderToSalesRecord(orderJson: unknown): SalesRecord {
  if (!isRecord(orderJson)) {
    throw new Error('shopify-tx-import: order must be an object');
  }
  const orderId = orderJson['id'];
  const context = orderId !== undefined ? ` (id ${String(orderId)})` : '';

  const name = orderJson['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`shopify-tx-import: order has no usable name${context}`);
  }

  const processedAt = orderJson['processedAt'];
  if (typeof processedAt !== 'string' || Number.isNaN(Date.parse(processedAt))) {
    throw new Error(`shopify-tx-import: order ${name} has no parseable processedAt`);
  }

  if (!('currentTotalPriceSet' in orderJson)) {
    throw new Error(`shopify-tx-import: order ${name} is missing currentTotalPriceSet`);
  }
  if (!('currentTotalTaxSet' in orderJson)) {
    throw new Error(`shopify-tx-import: order ${name} is missing currentTotalTaxSet`);
  }
  const totalCents = moneySetToCents(orderJson['currentTotalPriceSet'], 'currentTotalPriceSet');
  const taxCents = moneySetToCents(orderJson['currentTotalTaxSet'], 'currentTotalTaxSet');

  const refundedCents =
    orderJson['totalRefundedSet'] === undefined || orderJson['totalRefundedSet'] === null
      ? 0
      : moneySetToCents(orderJson['totalRefundedSet'], 'totalRefundedSet');

  const currency =
    moneySetCurrency(orderJson['currentTotalPriceSet']) ??
    (typeof orderJson['currencyCode'] === 'string' ? (orderJson['currencyCode'] as string) : null);
  if (currency === null || currency.trim() === '') {
    throw new Error(`shopify-tx-import: order ${name} has no currency`);
  }

  const grossCents = totalCents - taxCents;
  return {
    externalId: name,
    date: new Date(processedAt).toISOString(),
    grossCents,
    taxCents,
    feeCents: null,
    netCents: grossCents + taxCents - refundedCents,
    currency: currency.trim().toUpperCase(),
    refundedCents,
    status: normalizeStatus(orderJson['displayFinancialStatus']),
    provider: 'shopify',
    rawJson: orderJson,
  };
}

function moneySetToCents(value: unknown, field: string): number {
  if (!isRecord(value) || !('shopMoney' in value)) {
    throw new Error(`shopify-tx-import: ${field} must be a MoneySet with shopMoney`);
  }
  return moneyV2ToCents(value, field);
}

/**
 * True for Shopify Payments gateway identifiers (`shopify_payments`,
 * `"Shopify Payments"` …). Anything else — PayPal, Stripe, manual, COD —
 * produces no payout summary, so fees stay `null` for those orders.
 */
export function isShopifyPaymentsGateway(gateway: string): boolean {
  return gateway.toLowerCase().replace(/[^a-z0-9]/g, '') === 'shopifypayments';
}

/**
 * Fill `feeCents` from a Shopify Payments payout summary
 * (`ShopifyPaymentsPayoutSummary.chargesFee`) and recompute `netCents`.
 * Returns a new record; the input is untouched.
 *
 * - `gateway` (or a `gateway` field on the summary itself) that is NOT
 *   Shopify Payments → returned unchanged, `feeCents` stays `null`.
 * - Summary with no fee field → returned unchanged (no data, no guessing).
 */
export function applyPayoutSummary(
  record: SalesRecord,
  payoutSummaryJson: unknown,
  gateway?: string | null,
): SalesRecord {
  if (!isRecord(payoutSummaryJson)) {
    throw new Error('shopify-tx-import: payout summary must be an object');
  }
  const summaryGateway = payoutSummaryJson['gateway'];
  if (typeof summaryGateway === 'string' && !isShopifyPaymentsGateway(summaryGateway)) {
    return { ...record };
  }
  if (gateway !== undefined && gateway !== null && !isShopifyPaymentsGateway(gateway)) {
    return { ...record };
  }
  const fee = payoutSummaryJson['chargesFee'] ?? payoutSummaryJson['fee'] ?? null;
  if (fee === null || fee === undefined) {
    return { ...record };
  }
  const feeCents = moneyV2ToCents(fee, 'chargesFee');
  return {
    ...record,
    feeCents,
    netCents: record.grossCents + record.taxCents - record.refundedCents - feeCents,
  };
}

/**
 * True when two order ids name the same order: exact match, or same trailing
 * numeric segment (`gid://shopify/Order/6249512505633` vs `6249512505633`).
 */
function orderIdMatches(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' && typeof a !== 'number') return false;
  if (typeof b !== 'string' && typeof b !== 'number') return false;
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (sa === '' || sb === '') return false;
  if (sa === sb) return true;
  const tail = (s: string) => s.split('/').pop() ?? s;
  return tail(sa) === tail(sb);
}

function recordOrderId(record: SalesRecord): string | number | null {
  if (isRecord(record.rawJson)) {
    const id = record.rawJson['id'];
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return null;
}

/**
 * Fill `feeCents` from a Shopify Payments **balance transaction** for this
 * order (`ShopifyPaymentsBalanceTransaction.fee`) and recompute `netCents`.
 * Returns a new record; the input is untouched.
 *
 * This is the per-order fee source: `fee` is the processing fee for the
 * transaction linked to this order via `associatedOrder`. Contrast
 * {@link applyPayoutSummary}, whose `chargesFee` is a payout-level aggregate
 * over many orders and must never be attributed to a single order.
 *
 * Fail-closed (returned unchanged, `feeCents` stays `null`) when:
 *
 * - the transaction carries no `associatedOrder`, or it names a different
 *   order (matched by order id — GID or numeric, read from the record's
 *   `rawJson` — or by order `name` against the record's `externalId`);
 * - `test` is `true`: test-mode transactions expose no real fee (a `0.00`
 *   test fee is not bookable);
 * - `gateway` (param or `gateway` field on the transaction) is not Shopify
 *   Payments — balance transactions only exist for Shopify Payments anyway;
 * - the transaction carries no `fee` field.
 */
export function applyBalanceTransaction(
  record: SalesRecord,
  txJson: unknown,
  gateway?: string | null,
): SalesRecord {
  if (!isRecord(txJson)) {
    throw new Error('shopify-tx-import: balance transaction must be an object');
  }
  const txGateway = txJson['gateway'];
  if (typeof txGateway === 'string' && !isShopifyPaymentsGateway(txGateway)) {
    return { ...record };
  }
  if (gateway !== undefined && gateway !== null && !isShopifyPaymentsGateway(gateway)) {
    return { ...record };
  }
  if (txJson['test'] === true) {
    return { ...record };
  }
  const associated = txJson['associatedOrder'];
  if (!isRecord(associated)) {
    return { ...record };
  }
  const rawId = recordOrderId(record);
  const idHit =
    rawId !== null &&
    (orderIdMatches(associated['id'], rawId) || orderIdMatches(associated['id'], record.externalId));
  const nameHit =
    typeof associated['name'] === 'string' &&
    (associated['name'] as string).trim() !== '' &&
    (associated['name'] as string).trim() === record.externalId.trim();
  if (!idHit && !nameHit) {
    return { ...record };
  }
  const fee = txJson['fee'] ?? null;
  if (fee === null || fee === undefined) {
    return { ...record };
  }
  const feeCents = moneyV2ToCents(fee, 'fee');
  return {
    ...record,
    feeCents,
    netCents: record.grossCents + record.taxCents - record.refundedCents - feeCents,
  };
}

/**
 * Stable idempotency key for an order: `shopify_order:<id>`, where `<id>` is
 * the numeric Admin API id (or the full GID — either is stable, pick one and
 * stay with it). Re-ingesting the same order yields the same key, so the
 * importer can upsert instead of duplicating.
 */
export function shopifyOrderIdempotencyKey(orderId: string | number): string {
  const id = typeof orderId === 'string' ? orderId.trim() : orderId;
  if (id === '' || (typeof id === 'number' && !Number.isFinite(id))) {
    throw new Error('shopify-tx-import: order id must be a non-empty string or finite number');
  }
  return `shopify_order:${String(id)}`;
}

// Re-export the input shape for consumers building typed fixtures.
export type { ShopifyMoneySet, ShopifyMoneyV2 };
