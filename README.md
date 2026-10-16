# `shopify-tx-import`

Import Shopify **sales records** for bookkeeping. A pure order-to-ledger
adapter, Admin webhook verification, and a nightly backfill poll client —
sales only, no invoicing, carts, checkout, or agent-order code.

> Scope note: the UCP Order MCP was evaluated and **rejected** for this use —
> buyer-scoped, agent-orders-only, no payout data, no self-serve provisioning.
> See [`docs/scope.md`](./docs/scope.md).

---

## What this library covers

- **Order adapter** — map an Admin API Order to a `SalesRecord`
  (`externalId = name`, `date = processedAt`, gross = total − tax, refunds,
  normalized financial status). All money in integer cents.
- **Payout fees** — fill `feeCents` from a Shopify Payments payout summary
  (`chargesFee`); stays `null` for non-Shopify-Payments gateways.
- **Idempotency** — stable `shopify_order:<id>` keys for upsert imports.
- **Webhooks** — constant-time HMAC-SHA256 verification plus delivery dedupe
  on `x-shopify-webhook-id` for the sales topics.
- **Backfill polling** — orders by `updated_at` with cursor pagination over an
  injected executor (unit-testable, no network in tests). Targets Admin API
  `2026-10` via `@shopify/admin-api-client`.

---

## Installation

```bash
npm install @clocklobster/shopify-tx-import
```

---

## Quick start

```typescript
import { orderToSalesRecord, applyPayoutSummary } from '@clocklobster/shopify-tx-import';

const record = orderToSalesRecord(adminOrderJson);
// record: { externalId: '#1001', grossCents: 10000, taxCents: 1300,
//           feeCents: null, netCents: 11300, currency: 'CAD', ... }

const withFee = applyPayoutSummary(record, payoutSummaryJson, 'shopify_payments');
// withFee.feeCents === 33, netCents recomputed
```

### Verify a webhook

```typescript
import { verifyShopifyWebhook, createWebhookDedupe, isSupportedSalesTopic } from '@clocklobster/shopify-tx-import';

const dedupe = createWebhookDedupe(); // persist ids in Redis/DB for multi-process

async function handleWebhook(req: Request, secret: string) {
  const rawBody = await req.text(); // raw bytes BEFORE JSON.parse
  const ok = verifyShopifyWebhook(rawBody, req.headers.get('x-shopify-hmac-sha256'), secret);
  if (!ok) return new Response('unauthorized', { status: 401 });

  const topic = req.headers.get('x-shopify-topic') ?? '';
  if (!isSupportedSalesTopic(topic)) return new Response('ignored', { status: 200 });

  const webhookId = req.headers.get('x-shopify-webhook-id') ?? '';
  if (dedupe.seen(webhookId)) return new Response('duplicate', { status: 200 });

  // ... map JSON.parse(rawBody) via orderToSalesRecord, upsert on idempotency key
  return new Response('ok', { status: 200 });
}
```

### Nightly backfill

```typescript
import { createShopifyAdminExecutor, pollOrdersToSalesRecords } from '@clocklobster/shopify-tx-import';

const executor = createShopifyAdminExecutor({
  shop: process.env.SHOPIFY_SHOP!, // e.g. example.myshopify.com
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN!,
});

const records = await pollOrdersToSalesRecords({
  executor,
  updatedAtMin: lastRunTimestamp, // e.g. '2026-09-01T00:00:00Z'
});
```

Runnable example (no network): [`examples/basic.mjs`](./examples/basic.mjs) — run with `npm run build && node examples/basic.mjs`.

Rate-limit behavior for the poll (point bucket, restore rates, `429` shape): [`docs/RATE_LIMITS.md`](./docs/RATE_LIMITS.md).

---

## Quality and test discipline

- Unit tests with realistic Order/Refund/PayoutSummary fixtures (happy path,
  refund path, non-Shopify-Payments null-fee path, webhook HMAC
  accept/reject, idempotency-key stability).
- A fast-check property test pins the money invariant
  (`gross + tax − refunded − (fee ?? 0) === net`) across generated records.
- `npm test` (vitest) and `npm run typecheck` (`tsc --noEmit`) are the gates.

---

## License

MIT — see [LICENSE](./LICENSE).
