import { describe, expect, it } from 'vitest';
import {
  adminGraphqlEndpoint,
  buildOrdersUpdatedFilter,
  ORDERS_UPDATED_QUERY,
  pollOrdersToSalesRecords,
  pollUpdatedOrders,
  SHOPIFY_ADMIN_API_VERSION,
} from '../src/poll.js';
import type { GraphQLExecutor } from '../src/poll.js';
import { makeOrder } from './fixtures.js';

function page(nodes: unknown[], endCursor: string | null, hasNextPage: boolean) {
  return {
    data: {
      orders: {
        pageInfo: { hasNextPage, endCursor },
        edges: nodes.map((node, i) => ({ cursor: `cursor-${i}`, node })),
      },
    },
  };
}

describe('pollUpdatedOrders', () => {
  it('follows cursor pages and filters by updated_at', async () => {
    const seen: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const executor: GraphQLExecutor = async (query, variables) => {
      seen.push({ query, variables });
      if (variables['after'] == null) return page([makeOrder(), makeOrder({ name: '#1002' })], 'c1', true);
      return page([makeOrder({ name: '#1003' })], null, false);
    };

    const nodes: unknown[] = [];
    for await (const node of pollUpdatedOrders({ executor, updatedAtMin: '2026-09-01T00:00:00Z' })) {
      nodes.push(node);
    }
    expect(nodes).toHaveLength(3);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.variables).toMatchObject({ first: 100, after: null });
    expect(seen[1]?.variables).toMatchObject({ after: 'c1' });
    // Every page carries the same updated_at window filter.
    for (const call of seen) {
      expect(call.query).toBe(ORDERS_UPDATED_QUERY);
      expect(call.variables['query']).toContain("updated_at:>='2026-09-01T00:00:00Z'");
    }
  });

  it('throws on GraphQL errors instead of returning partial data', async () => {
    const executor: GraphQLExecutor = async () => ({
      data: null,
      errors: [{ message: 'Throttled' }],
    });
    await expect(
      (async () => {
        for await (const _ of pollUpdatedOrders({ executor, updatedAtMin: '2026-09-01T00:00:00Z' })) {
          // drain
        }
      })(),
    ).rejects.toThrow('Throttled');
  });

  it('throws when the cursor stalls', async () => {
    const executor: GraphQLExecutor = async () => page([makeOrder()], 'same', true);
    await expect(pollOrdersToSalesRecords({ executor, updatedAtMin: '2026-09-01T00:00:00Z' })).rejects.toThrow(
      'did not advance',
    );
  });

  it('rejects bad page sizes up front', async () => {
    const executor: GraphQLExecutor = async () => page([], null, false);
    await expect(
      pollOrdersToSalesRecords({ executor, updatedAtMin: '2026-09-01T00:00:00Z', pageSize: 251 }),
    ).rejects.toThrow('pageSize');
  });
});

describe('pollOrdersToSalesRecords', () => {
  it('maps every node through the adapter', async () => {
    const executor: GraphQLExecutor = async () =>
      page([makeOrder(), makeOrder({ name: '#1002', total: '226.00', tax: '26.00' })], null, false);
    const records = await pollOrdersToSalesRecords({
      executor,
      updatedAtMin: '2026-09-01T00:00:00Z',
      updatedAtMax: '2026-10-01T00:00:00Z',
    });
    expect(records.map((r) => r.externalId)).toEqual(['#1001', '#1002']);
    expect(records[1]?.grossCents).toBe(20000);
    for (const r of records) {
      expect(r.provider).toBe('shopify');
      expect(r.netCents).toBe(r.grossCents + r.taxCents - r.refundedCents - (r.feeCents ?? 0));
    }
  });
});

describe('query helpers', () => {
  it('pins the 2026-10 Admin API version', () => {
    expect(SHOPIFY_ADMIN_API_VERSION).toBe('2026-10');
    expect(adminGraphqlEndpoint('example.myshopify.com')).toBe(
      'https://example.myshopify.com/admin/api/2026-10/graphql.json',
    );
  });

  it('builds the updated_at window filter', () => {
    expect(buildOrdersUpdatedFilter('2026-09-01T00:00:00Z')).toBe("updated_at:>='2026-09-01T00:00:00Z'");
    expect(buildOrdersUpdatedFilter('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')).toBe(
      "updated_at:>='2026-09-01T00:00:00Z' AND updated_at:<='2026-10-01T00:00:00Z'",
    );
    expect(() => buildOrdersUpdatedFilter('yesterday-ish')).toThrow();
  });
});
