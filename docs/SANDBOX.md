# Dev-sandbox runbook

This package is **code-ready but sandbox-unproven**: unit tests cover the
adapter, webhooks, and poller against fixtures, but no live Shopify store has
been exercised yet. This runbook gets an operator from zero to a first
successful `examples/sandbox-smoke.mjs` run against a disposable dev store.
No step here requires committing secrets or touching production data.

> Assisted path: the fleet **`web-create-account`** skill can walk through the
> Partner signup + dev-store creation interactively. Ask your operator/agent
> harness to load it; everything below is the manual equivalent.

---

## 1. Partner account signup

1. Create a free Shopify Partner account at <https://partners.shopify.com/>.
2. Sign in to the **Partner Dashboard** — this is where dev stores are managed.
   Dev stores are free and cannot process real payments.

## 2. Create a dev store

Either:

- **Dev Dashboard** — Partner Dashboard → *Stores* → *Add store* → *Development
  store*, choosing the demo-data option to pre-seed products/orders; or
- **CLI** —
  ```bash
  shopify store create dev --demo-data
  ```

Record the store's `myshopify.com` domain (e.g. `<shop>.myshopify.com`) — it
becomes `SHOPIFY_SHOP` below. (Placeholder only; never paste a real domain
into docs or chat.)

## 3. Mint a custom-app Admin API token (`read_orders`)

The smoke script reads orders through a custom app on the dev store:

1. In the dev store admin: *Settings* → *Apps and sales channels* →
   *Develop apps* → *Create an app*.
2. Under *API credentials* → *Configure Admin API scopes*, grant the minimum
   this package needs: **`read_orders`**.
3. *Install app* on the dev store, then reveal the **Admin API access token**
   once and store it as `SHOPIFY_ACCESS_TOKEN` (env only — see §4).
   Rotate/revoke it from the same screen when done.

## 4. Environment

| Variable               | Value                                              |
| :---                   | :---                                               |
| `SHOPIFY_SHOP`         | Dev store domain, e.g. `<shop>.myshopify.com`      |
| `SHOPIFY_ACCESS_TOKEN` | Admin API token from §3 (env only, never in files) |

Rules:

- Env only. Never commit tokens, never paste them into docs, issues, or chat.
- The smoke script exits non-zero naming only the variable *names* when either
  is unset, and never prints credential *values* in any path.

## 5. Seed test orders

Without orders the smoke run trivially reports `orders: 0`. Either seed path
works:

- **Demo data** — the `--demo-data` flag (or Dashboard equivalent) in §2
  pre-seeds products and sample orders.
- **Bogus-gateway test orders** — enable the `(for testing) Bogus Gateway* in
  the dev store's payment settings, then place test checkouts against it to
  generate `orders/*` events plus refundable orders on demand.

Re-run the smoke after seeding to confirm a non-zero count.

## 6. Run the smoke

```bash
npm run build
node examples/sandbox-smoke.mjs          # expect fail-closed exit 1 (no creds)
SHOPIFY_SHOP=<shop>.myshopify.com SHOPIFY_ACCESS_TOKEN=<token> node examples/sandbox-smoke.mjs
```

Expected live output: an `orders: N` count line plus one JSON object per
record with exactly `{ externalId, date, grossCents, taxCents, feeCents,
netCents, currency }` — no `rawJson`, no customer/PII fields. The window is
the last 24h, `pageSize: 50`, `maxPages: 5`.

## 7. Webhook local-forward (optional)

To exercise `verifyShopifyWebhook` against real deliveries without deploying:

1. Run the app’s webhook receiver locally.
2. Forward dev-store `orders/create|paid|updated|cancelled` and
   `refunds/create` topics to `localhost` with the Shopify CLI dev tunnel
   (e.g. `shopify app dev` webhook forwarding) or an equivalent HTTPS tunnel.
3. Verify each delivery against the **raw** request body before `JSON.parse`
   (see README “Verify a webhook”).

## 8. Cleanup

- Revoke the custom-app token (or delete the dev store) when sandbox proof is
  complete. Dev stores are disposable — prefer a fresh one per verification
  round over reusing a stale store.
