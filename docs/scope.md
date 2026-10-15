# Scope — sales records for bookkeeping ONLY

`@clocklobster/shopify-tx-import` imports Shopify **sales records** into bookkeeping.
It is deliberately narrow:

## In scope

- `src/adapter.ts` — pure Admin Order → `SalesRecord` mapping plus Shopify
  Payments payout-summary fee fill. No I/O.
- `src/webhooks.ts` — Admin webhook HMAC verification (`X-Shopify-Hmac-Sha256`)
  and delivery dedupe on `x-shopify-webhook-id` for the sales topics
  (`orders/create|paid|updated|cancelled`, `refunds/create`).
- `src/poll.ts` — nightly backfill: orders by `updated_at` with cursor
  pagination over an injected GraphQL executor. Targets Admin API `2026-10`.

## Out of scope (by decision, not omission)

- **Invoicing endpoints** — bookkeeping reads sales; it never issues Shopify
  invoices. Use the Admin UI/API directly if you need invoices.
- **Cart / checkout code** — storefront concerns. This package only reads
  completed (or cancelled/refunded) order outcomes.
- **UCP / MCP ordering (UCP Order MCP)** — evaluated and **rejected**:
  the UCP Order flow is buyer-scoped and agent-orders-only, carries no payout
  (fee) data, and has no self-serve provisioning path. It cannot supply the
  gross/tax/fee/net record bookkeeping needs. Revisit only if Shopify ships a
  seller-scoped, payout-bearing order API outside Admin.

## Money rule

All amounts are integer cents. Shopify decimal strings convert via
`Math.round(n * 100)` at the adapter edge only. Invariant (property-tested):

```
grossCents + taxCents - refundedCents - (feeCents ?? 0) === netCents
```

`feeCents` is `null` until a Shopify Payments payout summary arrives, and
stays `null` for non-Shopify-Payments gateways (no fee data exists there).

## Webhook notes (Admin API v15+)

- Verify against the **raw** request body before `JSON.parse`.
- Dedupe on `x-shopify-webhook-id` (unique per delivery attempt, retries
  included). `eventId`/`resourceId` were dropped in v15 and `subTopic` was
  removed — do not key on them.
