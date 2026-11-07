import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

describe("rate limit", () => {
  it("allows up to the limit in the window, then blocks, then recovers", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("ip-a", 3, 60_000, t0 + i)).toBe(true);
    expect(rateLimit("ip-a", 3, 60_000, t0 + 10)).toBe(false);
    expect(rateLimit("ip-b", 3, 60_000, t0 + 10)).toBe(true);
    expect(rateLimit("ip-a", 3, 60_000, t0 + 60_001)).toBe(true);
  });
});
