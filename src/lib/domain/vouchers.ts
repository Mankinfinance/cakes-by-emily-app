// Gift vouchers and credit codes. Codes are formatted here; the secret used
// to derive them lives in services/tokens.ts. The database only stores a
// hash of each code and its last 4 characters.

import type { Voucher } from "./types";

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Turn 10 bytes (80 bits) into "XXXX-XXXX-XXXX-XXXX". */
export function formatCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += CODE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

/** Customers type codes in any case, with or without dashes or spaces. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function looksLikeCode(input: string): boolean {
  const n = normalizeCode(input);
  return n.length === 16 && [...n].every((c) => CODE_ALPHABET.includes(c));
}

export type VoucherProblem = "not_found" | "not_paid" | "void" | "expired" | "used_up";

export function voucherProblem(v: Voucher | null, today: string): VoucherProblem | null {
  if (!v) return "not_found";
  if (v.status === "pending") return "not_paid";
  if (v.status === "void") return "void";
  if (v.expiresOn < today) return "expired";
  if (v.balanceCents <= 0) return "used_up";
  return null;
}

export const VOUCHER_PROBLEM_TEXT: Record<VoucherProblem, string> = {
  not_found: "That code wasn't recognised. Please check it and try again.",
  not_paid: "That voucher hasn't been paid for yet.",
  void: "That code is no longer valid.",
  expired: "That code has expired.",
  used_up: "That code has no balance left.",
};

/** How much of a voucher to use against an amount owed. */
export function redemptionAmount(balanceCents: number, owingCents: number): number {
  return Math.max(0, Math.min(balanceCents, owingCents));
}
