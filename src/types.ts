/**
 * Bookkeeping sales-record model for Shopify.
 *
 * Scope: Shopify SALES records for bookkeeping import ONLY. This package has
 * no invoicing endpoints, no cart/checkout code, and no UCP/MCP code (the UCP
 * Order MCP was evaluated and rejected — buyer-scoped, agent-orders-only, no
 * payout data, no self-serve provisioning). See `docs/scope.md`.
 *
 * Money rule: every amount on {@link SalesRecord} is integer minor units
 * (cents). Shopify's decimal amount strings convert via `Math.round(n * 100)`
 * at the adapter edge only (`decimalToCents` in `adapter.ts`) — never in
 * consumers. The standing invariant is:
 *
 *   grossCents + taxCents - refundedCents - (feeCents ?? 0) === netCents
 */

/** Provider tag — every record from this package is Shopify-sourced. */
export type SalesProvider = 'shopify';

/**
 * Normalized form of the Admin API `displayFinancialStatus` enum.
 * Anything unrecognized maps to `'unknown'` (fail-open on status, never on money).
 */
export type ShopifySalesStatus =
  | 'pending'
  | 'authorized'
  | 'partially_paid'
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'voided'
  | 'unknown';

/**
 * One imported sale, ready for the books.
 *
 * - `externalId` is the Shopify order `name` (e.g. `#1001`).
 * - `date` is the order `processedAt` as an ISO-8601 string.
 * - `feeCents` is `null` until a Shopify Payments payout summary supplies it,
 *   and stays `null` for non-Shopify-Payments gateways (no fee data exists).
 * - `rawJson` is the original order payload for audit/replay.
 */
export interface SalesRecord {
  externalId: string;
  date: string;
  grossCents: number;
  taxCents: number;
  feeCents: number | null;
  netCents: number;
  currency: string;
  refundedCents: number;
  status: ShopifySalesStatus;
  provider: SalesProvider;
  rawJson: unknown;
}

/** Minimal shape of an Admin API `MoneyV2` value (`{ amount, currencyCode }`). */
export interface ShopifyMoneyV2 {
  amount: string | number;
  currencyCode: string;
}

/** Minimal shape of an Admin API `MoneySet` value. */
export interface ShopifyMoneySet {
  shopMoney: ShopifyMoneyV2;
}

/**
 * Minimal Admin API Order node fields consumed by `orderToSalesRecord`.
 * Extra fields pass through untouched inside `rawJson`.
 */
export interface ShopifyOrderNode {
  id?: string | number;
  name: string;
  processedAt: string;
  currencyCode?: string;
  currentTotalPriceSet: ShopifyMoneySet;
  currentTotalTaxSet: ShopifyMoneySet;
  totalRefundedSet?: ShopifyMoneySet;
  displayFinancialStatus?: string;
  taxLines?: Array<{ priceSet?: ShopifyMoneySet }>;
}

/** Minimal Shopify Payments payout-summary shape consumed by `applyPayoutSummary`. */
export interface ShopifyPayoutSummary {
  chargesFee?: ShopifyMoneyV2 | ShopifyMoneySet;
  fee?: ShopifyMoneyV2 | ShopifyMoneySet;
  gateway?: string;
}

/**
 * Minimal `ShopifyPaymentsAssociatedOrder` shape: the order a balance
 * transaction belongs to (`associatedOrder { id name }`).
 */
export interface ShopifyAssociatedOrder {
  id: string;
  name: string;
}

/**
 * Minimal `ShopifyPaymentsBalanceTransaction` shape consumed by
 * `applyBalanceTransaction`. Per-order fee source: `fee` is the processing
 * fee for THIS transaction (unlike the payout-summary `chargesFee`, which is
 * a payout-level aggregate over many orders and must never be attributed to
 * a single order).
 */
export interface ShopifyBalanceTransaction {
  id?: string | number;
  type?: string;
  test?: boolean;
  fee?: ShopifyMoneyV2 | ShopifyMoneySet;
  associatedOrder?: ShopifyAssociatedOrder | null;
  gateway?: string;
}
