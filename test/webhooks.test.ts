import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createWebhookDedupe,
  extractWebhookMetadata,
  isSupportedSalesTopic,
  SHOPIFY_SALES_TOPICS,
  verifyShopifyWebhook,
} from '../src/webhooks.js';

const SECRET = 'test-api-secret-key';
const RAW_BODY = JSON.stringify({ id: 6249512505633, name: '#1001', total_price: '113.00' });

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifyShopifyWebhook', () => {
  it('accepts a correctly signed payload', () => {
    expect(verifyShopifyWebhook(RAW_BODY, sign(RAW_BODY, SECRET), SECRET)).toBe(true);
  });

  it('accepts Buffer bodies', () => {
    expect(
      verifyShopifyWebhook(Buffer.from(RAW_BODY, 'utf8'), sign(RAW_BODY, SECRET), SECRET),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = RAW_BODY.replace('#1001', '#1002');
    expect(verifyShopifyWebhook(tampered, sign(RAW_BODY, SECRET), SECRET)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyShopifyWebhook(RAW_BODY, sign(RAW_BODY, 'other-secret'), SECRET)).toBe(false);
  });

  it('rejects missing/empty headers, secrets, and malformed digests', () => {
    expect(verifyShopifyWebhook(RAW_BODY, null, SECRET)).toBe(false);
    expect(verifyShopifyWebhook(RAW_BODY, undefined, SECRET)).toBe(false);
    expect(verifyShopifyWebhook(RAW_BODY, '', SECRET)).toBe(false);
    expect(verifyShopifyWebhook(RAW_BODY, sign(RAW_BODY, SECRET), '')).toBe(false);
    expect(verifyShopifyWebhook(RAW_BODY, '!!!not-base64!!!', SECRET)).toBe(false);
    expect(verifyShopifyWebhook(RAW_BODY, Buffer.from('short').toString('base64'), SECRET)).toBe(
      false,
    );
  });
});

describe('sales topics', () => {
  it('supports the five sales topics and nothing else', () => {
    expect([...SHOPIFY_SALES_TOPICS]).toEqual([
      'orders/create',
      'orders/paid',
      'orders/updated',
      'orders/cancelled',
      'refunds/create',
    ]);
    for (const topic of SHOPIFY_SALES_TOPICS) {
      expect(isSupportedSalesTopic(topic)).toBe(true);
    }
    expect(isSupportedSalesTopic('orders/delete')).toBe(false);
    expect(isSupportedSalesTopic('carts/create')).toBe(false);
    expect(isSupportedSalesTopic('checkouts/create')).toBe(false);
  });
});

describe('extractWebhookMetadata', () => {
  it('reads headers case-insensitively', () => {
    const meta = extractWebhookMetadata({
      'X-Shopify-Webhook-Id': 'abc-123',
      'x-shopify-topic': 'orders/paid',
      'X-SHOPIFY-SHOP-DOMAIN': 'example.myshopify.com',
      'x-shopify-api-version': '2026-10',
    });
    expect(meta).toEqual({
      webhookId: 'abc-123',
      topic: 'orders/paid',
      shopDomain: 'example.myshopify.com',
      apiVersion: '2026-10',
    });
  });

  it('returns nulls for missing headers', () => {
    expect(extractWebhookMetadata({})).toEqual({
      webhookId: null,
      topic: null,
      shopDomain: null,
      apiVersion: null,
    });
  });
});

describe('createWebhookDedupe', () => {
  it('flags the second delivery of the same webhookId', () => {
    const dedupe = createWebhookDedupe();
    expect(dedupe.seen('webhook-1')).toBe(false);
    expect(dedupe.seen('webhook-1')).toBe(true);
    expect(dedupe.seen('webhook-2')).toBe(false);
    expect(dedupe.size).toBe(2);
  });

  it('never dedupes blank ids', () => {
    const dedupe = createWebhookDedupe();
    expect(dedupe.seen('')).toBe(false);
    expect(dedupe.seen('   ')).toBe(false);
    expect(dedupe.size).toBe(0);
  });

  it('expires ids after the TTL', () => {
    vi.useFakeTimers();
    try {
      const dedupe = createWebhookDedupe({ ttlMs: 1000 });
      expect(dedupe.seen('webhook-1')).toBe(false);
      vi.setSystemTime(Date.now() + 1001);
      expect(dedupe.seen('webhook-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts oldest-first past maxSize', () => {
    const dedupe = createWebhookDedupe({ maxSize: 2 });
    dedupe.seen('a');
    dedupe.seen('b');
    dedupe.seen('c');
    expect(dedupe.size).toBe(2);
    expect(dedupe.seen('a')).toBe(false); // evicted
    expect(dedupe.seen('c')).toBe(true); // retained
  });
});
