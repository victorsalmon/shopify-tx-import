// Dev-sandbox smoke: poll the last 24h of orders into sales records.
//
// Usage (operator only — performs live Admin API calls):
//   npm run build
//   SHOPIFY_SHOP=<shop>.myshopify.com SHOPIFY_ACCESS_TOKEN=<token> node examples/sandbox-smoke.mjs
//
// Fail-closed: when either env var is unset or blank the script exits non-zero
// and names ONLY the variable names — it never prints credential values.
// Output is counts plus per-record { externalId, date, grossCents, taxCents,
// feeCents, netCents, currency } — no rawJson, no PII. See docs/SANDBOX.md.

import {
  createShopifyAdminExecutor,
  pollOrdersToSalesRecords,
} from '../dist/index.js';

const REQUIRED_ENV = ['SHOPIFY_SHOP', 'SHOPIFY_ACCESS_TOKEN'];

const missing = REQUIRED_ENV.filter((name) => {
  const value = process.env[name];
  return typeof value !== 'string' || value.trim() === '';
});

if (missing.length > 0) {
  // Names only — never interpolate process.env values here.
  console.error(
    `shopify-tx-import sandbox smoke: missing required env vars: ${missing.join(', ')}`,
  );
  console.error(
    'Set them in the environment and re-run (see docs/SANDBOX.md). Values are never printed.',
  );
  process.exit(1);
}

const shop = process.env['SHOPIFY_SHOP'].trim();
const accessToken = process.env['SHOPIFY_ACCESS_TOKEN'];

const now = new Date();
const updatedAtMax = now.toISOString();
const updatedAtMin = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

try {
  const executor = createShopifyAdminExecutor({ shop, accessToken });
  const records = await pollOrdersToSalesRecords({
    executor,
    updatedAtMin,
    updatedAtMax,
    pageSize: 50,
    maxPages: 5,
  });

  console.log(`orders: ${records.length}`);
  for (const record of records) {
    // Sanitized projection only — rawJson and any customer/PII fields stay out.
    console.log(
      JSON.stringify({
        externalId: record.externalId,
        date: record.date,
        grossCents: record.grossCents,
        taxCents: record.taxCents,
        feeCents: record.feeCents,
        netCents: record.netCents,
        currency: record.currency,
      }),
    );
  }
} catch (error) {
  console.error(
    `shopify-tx-import sandbox smoke: poll failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
