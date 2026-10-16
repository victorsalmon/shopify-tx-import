# Changelog

All notable changes to `@clocklobster/shopify-tx-import` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added

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
