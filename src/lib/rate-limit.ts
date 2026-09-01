import "server-only";

// In-memory fixed-window rate limiter with LRU eviction.
interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Maximum active rate-limit buckets maintained in memory per server instance.
const MAX_BUCKETS = 20_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

function pruneBuckets(now: number, windowMs: number) {
  // 1. Evict expired entries first
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }

  // 2. If still exceeding MAX_BUCKETS, evict the oldest 20% by insertion/access order
  if (buckets.size >= MAX_BUCKETS) {
    const toDeleteCount = Math.floor(MAX_BUCKETS * 0.2);
    let deleted = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      deleted++;
      if (deleted >= toDeleteCount) break;
    }
  }
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    if (buckets.size >= MAX_BUCKETS) {
      pruneBuckets(now, windowMs);
    }
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  existing.count += 1;
  // Re-insert to refresh LRU position
  buckets.delete(key);
  buckets.set(key, existing);

  const allowed = existing.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.windowStart + windowMs,
  };
}
