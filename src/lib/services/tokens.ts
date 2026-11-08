// Private order links. The link token is an HMAC of the order id, so the
// website can rebuild it for reminder emails, but the database only stores a
// SHA-256 hash of it. Someone with a copy of the database alone cannot open orders.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { formatCode, normalizeCode } from "../domain/vouchers";

const TEST_SECRET = "memory-mode-test-secret-not-for-production-use";

function secret(): string {
  const s = process.env.ORDER_LINK_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.DATA_ADAPTER === "memory") return TEST_SECRET;
  throw new Error("ORDER_LINK_SECRET must be set to a random string of at least 32 characters.");
}

export function orderToken(orderId: string): string {
  return createHmac("sha256", secret()).update(`order:${orderId}`).digest("base64url");
}

/** Private link for a seasonal box order. */
export function boxToken(boxOrderId: string): string {
  return createHmac("sha256", secret()).update(`box:${boxOrderId}`).digest("base64url");
}

/**
 * A voucher or credit code, derived from its id with the secret so it can be
 * emailed after payment while the database only keeps its hash.
 */
export function voucherCode(voucherId: string): string {
  const mac = createHmac("sha256", secret()).update(`voucher:${voucherId}`).digest();
  return formatCode(new Uint8Array(mac.subarray(0, 10)));
}

export function hashCode(code: string): string {
  return createHash("sha256").update(`code:${normalizeCode(code)}`).digest("hex");
}

/** A random one-off token (waitlist claim links). Only its hash is stored. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A short reference customers can quote, e.g. CBE-7K3QX (boxes use BOX-). */
export function newReference(prefix = "CBE"): string {
  let out = "";
  for (let i = 0; i < 5; i++) out += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `${prefix}-${out}`;
}
