# Rate limits — Shopify Admin GraphQL (orders poll)

Vendor docs are authoritative. Every figure below carries its source URL.
Anything we could not verify in vendor docs is marked **UNVERIFIED** — never
guessed.

## Model: calculated query cost, leaky bucket

Calls to the GraphQL Admin API are limited by **calculated query cost**
(cost points), not by request count. Each app+store pair gets a bucket that
refills continuously; short bursts are fine as long as average cost stays
under the restore rate.

- Source: <https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits>
- Bucket model: <https://shopify.dev/docs/api/usage/limits>

## Restore rates by plan (points/second)

| Plan | Restore rate |
| ---- | ------------ |
| Standard | 100 points/second |
| Advanced Shopify | 200 points/second |
| Shopify Plus | 1000 points/second |
| Shopify for enterprise (Commerce Components) | 2000 points/second |

- Source: <https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits>

## Hard caps

- A **single query may not exceed a cost of 1,000 points**, regardless of
  plan. Enforced pre-execution on requested cost.
  - Source: <https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits>
  - Also: <https://shopify.dev/docs/api/admin-graphql/2026-10>
- Requested cost is charged pre-execution; the difference between requested
  and actual cost is **refunded** to the bucket after execution.
  - Source: <https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits>
- **UNVERIFIED**: the exact per-plan bucket capacity (`maximumAvailable`)
  for a given shop. Vendor examples show `1000.0`, but plan-specific
  capacities are not published — read `throttleStatus.maximumAvailable` at
  runtime instead of hard-coding it.
- **UNVERIFIED**: any published per-app concurrency (parallel-request)
  limit for GraphQL Admin queries. No numeric concurrency limit is
  documented — keep poll concurrency at 1 per shop (see checklist).

## Throttle signals

- Every response carries cost state under `extensions.cost`:
  `requestedQueryCost`, `actualQueryCost`, and
  `throttleStatus` (`maximumAvailable`, `currentlyAvailable`, `restoreRate`).
  - Source: <https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits>
- Over-budget queries are rejected (HTTP `429`, `errors[].extensions.code`
  such as `MAX_COST_EXCEEDED` with `cost` / `maxCost` fields).
  - Source: <https://shopify.dev/docs/api/admin-graphql/2026-10>
- Rate limits are shared across all tokens of the same app on the same
  store (app + store bucket, not per-token) — minting extra tokens does not
  raise the limit.
  - Source: <https://community.shopify.dev/t/are-the-rate-limits-for-client-credentials-separate-for-each-token/27682>
  (vendor-staff answer; treat token-sharing behavior as vendor-stated, not
  as a formal limit figure)

## Orders-poll guidance (this package)

- Page `orders` by `updated_at` with small `first:` page sizes so each
  query stays far under the 1,000-point single-query cap.
- Read `extensions.cost.throttleStatus.currentlyAvailable` after each page;
  pause when low instead of polling into a `429`.
- Run **one poll loop at a time per shop**; concurrent loops share the same
  app+store bucket and only burn it faster.

## HOST_CHECKLIST

- [ ] Jittered backoff: on `429`, retry with exponential backoff plus
      random jitter; never tight-loop.
- [ ] Retry-After respect: honor any vendor wait directive
      (`windowResetAt` / `Retry-After`-style headers) before the next
      attempt. **UNVERIFIED**: which wait directive shape the orders poll
      will see — implement generic "wait until told" handling.
- [ ] Per-tenant serialization: one poll loop per shop at a time; no
      parallel backfills against the same store.
- [ ] Alerting: log `requestedQueryCost` / `currentlyAvailable` per poll;
      alert on repeated `429`s (means page size too large or restore rate
      exceeded on average).
