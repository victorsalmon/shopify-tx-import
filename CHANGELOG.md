# Changelog

All notable changes to `@clocklobster/shopify-tx-import` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added

- `applyBalanceTransaction` adapter: per-order fee fill from
  `ShopifyPaymentsBalanceTransaction.fee`, matched on `associatedOrder`
  (order id — GID or numeric — or `name` vs `externalId`); fail-closed on
  order mismatch, missing `associatedOrder`/`fee`, test-mode transactions
  (`test: true` exposes no real fee), and non-Shopify-Payments gateways.
  Recomputes `netCents`; input untouched. Payout-summary `chargesFee` is
  documented as payout-aggregate (never per-order).
- `taxLines { title rate priceSet }` selection on `ORDERS_UPDATED_QUERY`
  for exact tax cross-checks (`taxCents === Σ taxLines`).
- `docs/FEES.md`: the payouts fee leg (per-order vs payout-aggregate
  sources, vendor object/scope references) plus the live-verified
  documented-blocked verdict — dev-store token grants `read_orders` only,
  and every payouts-leg query fails with "Access denied for
  shopifyPaymentsAccount field. Required access: the `read_shopify_payments`
  or the `read_shopify_payments_accounts` access scope." No scope requested
  or granted per bead rules.
- Regression suite `test/fees-tax.test.ts` (fee mapping + exact tax math,
  hermetic): single-HST (`#1003`: 20000 + 2600 = 22600), multi-tax
  (`#1004`: 10000 + 500 + 700 = 11200), `taxCents === Σ taxLines` across
  fixtures, balance-transaction match/mismatch/test-mode/gateway cases.
- `docs/RATE_LIMITS.md`: vendor-verified GraphQL Admin rate limits for the
  orders poll (per-plan point restore rates, 1,000-point single-query cap,
  `extensions.cost` throttle signals, `429` shape) plus the host checklist.
  Per-plan bucket capacity and numeric concurrency limits are marked
  UNVERIFIED (unpublished by the vendor).

## [0.1.0] — 2026-10-15

### Added

- `SalesRecord` model (integer cents, nullable `feeCents`, `provider: 'shopify'`).
- Pure `orderToSalesRecord` adapter (name/date/totals/refunds/status mapping).
- `applyPayoutSummary` fee fill from Shopify Payments payout summaries
  (stays `null` for non-Shopify-Payments gateways).
- `shopifyOrderIdempotencyKey` (`shopify_order:<id>`) helper.
- Admin webhook HMAC verification, sales-topic allowlist
  (`orders/create|paid|updated|cancelled`, `refunds/create`), header metadata
  extraction, and in-memory delivery dedupe on `webhookId`.
- Nightly backfill poll client (`updated_at` window + cursor pagination over
  an injected executor; production executor over `@shopify/admin-api-client`),
  targeting Admin API `2026-10`.
- Unit suite (fixtures: happy/refund/null-fee/HMAC/idempotency) plus a
  fast-check money-invariant property test.
