/**
 * Admin webhook verification + dedupe guidance.
 *
 * Verification: Shopify signs the RAW request body with HMAC-SHA256 using the
 * app's API secret key and sends the base64 digest in `X-Shopify-Hmac-Sha256`.
 * Always verify against the raw bytes BEFORE `JSON.parse` — re-serializing
 * changes whitespace/key order and breaks the digest.
 *
 * Dedupe: Shopify retries webhook deliveries, so the same event can arrive
 * twice. Dedupe on `x-shopify-webhook-id`, which is unique per delivery
 * attempt. Note (Admin API v15+): `eventId`/`resourceId` are gone and
 * `subTopic` was removed — `webhookId` is the key. Persist seen ids with a
 * TTL longer than Shopify's retry window; {@link createWebhookDedupe} is an
 * in-memory helper for single-process consumers.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Sales topics this package handles. Everything else is ignored. */
export const SHOPIFY_SALES_TOPICS = [
  'orders/create',
  'orders/paid',
  'orders/updated',
  'orders/cancelled',
  'refunds/create',
] as const;

export type ShopifySalesTopic = (typeof SHOPIFY_SALES_TOPICS)[number];

export function isSupportedSalesTopic(topic: string): topic is ShopifySalesTopic {
  return (SHOPIFY_SALES_TOPICS as readonly string[]).includes(topic);
}

/**
 * Verify an Admin webhook payload. Returns `true` only when the HMAC matches;
 * `false` for a missing header, missing secret, undecodable digest, or any
 * mismatch. Comparison is constant-time.
 */
export function verifyShopifyWebhook(
  rawBody: string | Uint8Array,
  hmacHeader: string | null | undefined,
  secret: string,
): boolean {
  if (typeof hmacHeader !== 'string' || hmacHeader === '' || secret === '') {
    return false;
  }
  let provided: Buffer;
  try {
    provided = Buffer.from(hmacHeader, 'base64');
  } catch {
    return false;
  }
  const digest = createHmac('sha256', secret).update(rawBody).digest();
  if (provided.length !== digest.length || provided.length === 0) {
    return false;
  }
  return timingSafeEqual(digest, provided);
}

export interface ShopifyWebhookMetadata {
  webhookId: string | null;
  topic: string | null;
  shopDomain: string | null;
  apiVersion: string | null;
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
      return value === undefined ? null : String(value);
    }
  }
  return null;
}

/** Pull the dedupe/routing metadata out of Admin webhook headers (case-insensitive). */
export function extractWebhookMetadata(
  headers: Record<string, string | string[] | undefined>,
): ShopifyWebhookMetadata {
  return {
    webhookId: headerValue(headers, 'x-shopify-webhook-id'),
    topic: headerValue(headers, 'x-shopify-topic'),
    shopDomain: headerValue(headers, 'x-shopify-shop-domain'),
    apiVersion: headerValue(headers, 'x-shopify-api-version'),
  };
}

export interface WebhookDedupe {
  /**
   * Returns `true` when this id was already seen (a duplicate delivery —
   * skip it) and `false` when it is new (recorded for future calls).
   * Blank ids cannot be deduped and always return `false`.
   */
  seen(webhookId: string): boolean;
  readonly size: number;
}

export interface WebhookDedupeOptions {
  /** How long a seen id suppresses redelivery. Default: 24 h. */
  ttlMs?: number;
  /** Max tracked ids; oldest-first eviction past the cap. Default: 10 000. */
  maxSize?: number;
}

const DEFAULT_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEDUPE_MAX_SIZE = 10_000;

/** Single-process in-memory delivery dedupe. Multi-process consumers: back this with Redis/DB. */
export function createWebhookDedupe(options?: WebhookDedupeOptions): WebhookDedupe {
  const ttlMs = options?.ttlMs ?? DEFAULT_DEDUPE_TTL_MS;
  const maxSize = options?.maxSize ?? DEFAULT_DEDUPE_MAX_SIZE;
  const seenAt = new Map<string, number>();

  function sweep(now: number): void {
    for (const [id, at] of seenAt) {
      if (now - at >= ttlMs) seenAt.delete(id);
      else break; // insertion-ordered: older entries come first
    }
  }

  return {
    seen(webhookId: string): boolean {
      if (webhookId.trim() === '') return false;
      const now = Date.now();
      sweep(now);
      const previous = seenAt.get(webhookId);
      if (previous !== undefined && now - previous < ttlMs) return true;
      seenAt.delete(webhookId); // re-insert to refresh recency
      seenAt.set(webhookId, now);
      while (seenAt.size > maxSize) {
        const oldest = seenAt.keys().next();
        if (oldest.done) break;
        seenAt.delete(oldest.value);
      }
      return false;
    },
    get size(): number {
      sweep(Date.now());
      return seenAt.size;
    },
  };
}
