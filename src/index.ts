/**
 * Public exports for `@clocklobster/shopify-tx-import`.
 *
 * Sales-record import for bookkeeping ONLY — no invoicing, cart/checkout,
 * or UCP/MCP code (see `docs/scope.md`).
 */

export type {
  SalesProvider,
  ShopifySalesStatus,
  SalesRecord,
  ShopifyMoneyV2,
  ShopifyMoneySet,
  ShopifyOrderNode,
  ShopifyPayoutSummary,
  ShopifyAssociatedOrder,
  ShopifyBalanceTransaction,
} from './types.js';

export {
  decimalToCents,
  orderToSalesRecord,
  isShopifyPaymentsGateway,
  applyPayoutSummary,
  applyBalanceTransaction,
  shopifyOrderIdempotencyKey,
} from './adapter.js';

export {
  SHOPIFY_SALES_TOPICS,
  isSupportedSalesTopic,
  verifyShopifyWebhook,
  extractWebhookMetadata,
  createWebhookDedupe,
} from './webhooks.js';
export type {
  ShopifySalesTopic,
  ShopifyWebhookMetadata,
  WebhookDedupe,
  WebhookDedupeOptions,
} from './webhooks.js';

export {
  SHOPIFY_ADMIN_API_VERSION,
  adminGraphqlEndpoint,
  ORDERS_UPDATED_QUERY,
  buildOrdersUpdatedFilter,
  pollUpdatedOrders,
  pollOrdersToSalesRecords,
  createShopifyAdminExecutor,
} from './poll.js';
export type {
  GraphQLExecutor,
  PollOrdersOptions,
  ShopifyAdminAuth,
} from './poll.js';
