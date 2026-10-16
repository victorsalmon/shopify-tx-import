# Fee mapping — Shopify payouts leg

Order objects expose **no fee**, in test mode or otherwise: `orderToSalesRecord`
sets `feeCents: null` and `netCents` is the pre-fee net. Fee data lives on the
Shopify Payments **payouts leg** only, and only for orders paid through
Shopify Payments (PayPal / Stripe / manual / COD orders never produce payout
data, so their `feeCents` stays `null` by design).

## The two fee sources (do not confuse them)

| Source | Object.field | Grain | Consumer |
| :----- | :----------- | :---- | :------- |
| Payout summary | `ShopifyPaymentsPayout.summary.chargesFee` | **Payout aggregate** over many orders | `applyPayoutSummary` (kept for payout-level reconciliation; must NEVER be attributed to a single order) |
| Balance transaction | `ShopifyPaymentsBalanceTransaction.fee` + `associatedOrder { id name }` | **Per order/charge** | `applyBalanceTransaction` (the per-order fee source for `SalesRecord.feeCents`) |

`applyBalanceTransaction` is fail-closed: unchanged record when the
transaction has no `associatedOrder`, names a different order (id — GID or
numeric — or `name` vs `externalId`), is test-mode (`test: true` carries no
real fee), names a non-Shopify-Payments gateway, or carries no `fee`.

## Required access scope — CURRENTLY NOT GRANTED (documented-blocked)

Live-probed 2026-10-16 against the dev store (custom-app token, confirmed
grants: `read_orders` only). Every payouts-leg entry point fails identically:

```graphql
{ shopifyPaymentsAccount { payouts(first: 1) { edges { node { id } } } } }
{ shopifyPaymentsAccount { balanceTransactions(first: 1) { edges { node { id } } } } }
```

```
Access denied for shopifyPaymentsAccount field. Required access: the
`read_shopify_payments` or the `read_shopify_payments_accounts` access scope.
```

So fee mapping needs, at minimum:

- `read_shopify_payments_accounts` (or `read_shopify_payments`) — just to
  enter `shopifyPaymentsAccount` (vendor error above; live-verified), and
- `read_shopify_payments_payouts` — covers `ShopifyPaymentsPayout` and
  `ShopifyPaymentsBalanceTransaction`
  (source: <https://shopify.dev/docs/api/usage/access-scopes>).

Per bead rules no scope was requested or granted; fee stays **documented-blocked**
until a future grant adds them. Test-mode orders would expose no fee even with
the scope (no real processing fee exists), so the hermetic fixtures in
`test/fixtures.ts` (`makeBalanceTransaction`) stand in for the live shape.

## Object references (Admin API `2026-10`)

- `ShopifyPaymentsPayoutSummary` (`chargesFee`, `chargesGross`, `refundsFee`, …):
  <https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsPayoutSummary>
- `ShopifyPaymentsPayout`:
  <https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsPayout>
- `ShopifyPaymentsBalanceTransaction` (`fee`, `associatedOrder`, `test`):
  <https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsBalanceTransaction>
- Access scopes (`read_shopify_payments_payouts`, …):
  <https://shopify.dev/docs/api/usage/access-scopes>

## Live verification log (dev store only, read-only)

- 90-day orders window: 1 order (`#1001`, gross 3695 / tax 0 / refunded 0 /
  net 3695 CAD, PAID, empty `taxLines`) — no taxed order exists, so exact tax
  math is proven hermetically (`test/fees-tax.test.ts`: `#1003` HST,
  `#1004` GST+PST, `taxCents === Σ taxLines` in all fixtures).
- Token minted via OAuth `client_credentials` grant against the dev store
  (short-lived, `expires_in` 86399); shared refresh-token state untouched.
