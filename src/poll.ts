/**
 * Nightly backfill poll client: orders by `updated_at` with cursor pagination.
 *
 * The GraphQL call itself is injected as a {@link GraphQLExecutor}, so every
 * path here is unit-testable without network. The production executor
 * ({@link createShopifyAdminExecutor}) is a thin wrapper over
 * `@shopify/admin-api-client` (MIT) pinned to {@link SHOPIFY_ADMIN_API_VERSION}.
 */

import { createAdminApiClient } from '@shopify/admin-api-client';
import { orderToSalesRecord } from './adapter.js';
import type { SalesRecord } from './types.js';

/** Admin API version this package targets. Bump deliberately — fields deprecate. */
export const SHOPIFY_ADMIN_API_VERSION = '2026-10';

/** `https://<shop>/admin/api/2026-10/graphql.json` for a `myshopify.com` domain. */
export function adminGraphqlEndpoint(shopDomain: string): string {
  const shop = shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (shop === '') throw new Error('shopify-tx-import: shop domain must be non-empty');
  return `https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
}

/** Minimal GraphQL executor surface. Inject a fake in tests; never hit network there. */
export type GraphQLExecutor = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<{
  data?: unknown;
  errors?: Array<{ message?: unknown }> | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Orders query used by the backfill: filter by `updated_at`, sort oldest-first for stable paging. */
export const ORDERS_UPDATED_QUERY = /* GraphQL */ `
  query OrdersUpdated($query: String!, $first: Int!, $after: String) {
    orders(query: $query, first: $first, after: $after, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          name
          processedAt
          currencyCode
          currentTotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          currentTotalTaxSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          taxLines {
            title
            rate
            priceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
          displayFinancialStatus
        }
      }
    }
  }
`;

/** Build the `updated_at` search filter. Bounds must be parseable dates. */
export function buildOrdersUpdatedFilter(updatedAtMin: string, updatedAtMax?: string): string {
  if (Number.isNaN(Date.parse(updatedAtMin))) {
    throw new Error('shopify-tx-import: updatedAtMin must be a parseable date');
  }
  let filter = `updated_at:>='${updatedAtMin}'`;
  if (updatedAtMax !== undefined) {
    if (Number.isNaN(Date.parse(updatedAtMax))) {
      throw new Error('shopify-tx-import: updatedAtMax must be a parseable date');
    }
    filter += ` AND updated_at:<='${updatedAtMax}'`;
  }
  return filter;
}

export interface PollOrdersOptions {
  executor: GraphQLExecutor;
  /** Inclusive lower bound, e.g. last successful nightly run timestamp. */
  updatedAtMin: string;
  /** Optional upper bound to cap the window. */
  updatedAtMax?: string;
  /** Page size, 1–250 (Shopify caps `first` at 250). Default: 100. */
  pageSize?: number;
  /** Safety cap on pages per run. Default: 500. */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 500;

/**
 * Yield raw order nodes updated in the window, oldest first, following cursor
 * pages until `hasNextPage` is false. Throws on GraphQL `errors`, on a
 * malformed connection shape, or when the cursor stops advancing / the page
 * cap is hit (fail loud — a silent partial backfill corrupts the books).
 */
export async function* pollUpdatedOrders(options: PollOrdersOptions): AsyncGenerator<unknown> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 250) {
    throw new Error('shopify-tx-import: pageSize must be an integer in 1..250');
  }
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const filter = buildOrdersUpdatedFilter(options.updatedAtMin, options.updatedAtMax);

  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const response = await options.executor(ORDERS_UPDATED_QUERY, {
      query: filter,
      first: pageSize,
      after,
    });
    if (response.errors !== undefined && response.errors !== null && response.errors.length > 0) {
      const first = response.errors[0];
      throw new Error(
        `shopify-tx-import: orders query failed: ${String(first?.message ?? 'unknown GraphQL error')}`,
      );
    }
    if (!isRecord(response.data) || !isRecord(response.data['orders'])) {
      throw new Error('shopify-tx-import: orders query returned no orders connection');
    }
    const connection = response.data['orders'] as Record<string, unknown>;
    const edges = connection['edges'];
    if (!Array.isArray(edges)) {
      throw new Error('shopify-tx-import: orders connection has no edges array');
    }
    for (const edge of edges) {
      if (isRecord(edge) && 'node' in edge) yield edge['node'];
      else throw new Error('shopify-tx-import: orders edge has no node');
    }
    const pageInfo = connection['pageInfo'];
    if (!isRecord(pageInfo)) {
      throw new Error('shopify-tx-import: orders connection has no pageInfo');
    }
    if (pageInfo['hasNextPage'] !== true) return;
    const endCursor = pageInfo['endCursor'];
    if (typeof endCursor !== 'string' || endCursor === '' || endCursor === after) {
      throw new Error('shopify-tx-import: pagination cursor did not advance');
    }
    after = endCursor;
  }
  throw new Error(`shopify-tx-import: backfill exceeded ${maxPages} pages — narrow the window`);
}

/**
 * Collect the backfill window into {@link SalesRecord}s. An unmappable node
 * throws (via `orderToSalesRecord`) — fix the data, don't silently drop money.
 */
export async function pollOrdersToSalesRecords(
  options: PollOrdersOptions,
): Promise<SalesRecord[]> {
  const records: SalesRecord[] = [];
  for await (const node of pollUpdatedOrders(options)) {
    records.push(orderToSalesRecord(node));
  }
  return records;
}

export interface ShopifyAdminAuth {
  /** `myshopify.com` domain, e.g. `example.myshopify.com`. */
  shop: string;
  /** Admin API access token (custom app or OAuth). Never commit one. */
  accessToken: string;
}

/**
 * Production executor over `@shopify/admin-api-client` with the package's
 * pinned API version. All network errors propagate to the caller — the nightly
 * job owns retry/backoff policy.
 */
export function createShopifyAdminExecutor(auth: ShopifyAdminAuth): GraphQLExecutor {
  if (auth.shop.trim() === '' || auth.accessToken === '') {
    throw new Error('shopify-tx-import: shop and accessToken are required');
  }
  const client = createAdminApiClient({
    storeDomain: auth.shop.trim(),
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    accessToken: auth.accessToken,
  });
  return async (query, variables) => {
    const response = await client.request(query, { variables });
    if (!response.errors) return { data: response.data, errors: null };
    // Normalize ResponseErrors ({ message, graphQLErrors, networkStatusCode })
    // to the executor contract's [{ message }] shape at the boundary.
    const message =
      response.errors.message ??
      response.errors.graphQLErrors?.[0]?.message ??
      `request failed (HTTP ${response.errors.networkStatusCode ?? 'unknown'})`;
    return { data: response.data, errors: [{ message }] };
  };
}
