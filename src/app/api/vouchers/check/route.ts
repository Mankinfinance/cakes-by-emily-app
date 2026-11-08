import { getRepo } from "@/lib/data";
import { todayInBusinessTz } from "@/lib/domain/dates";
import { clientIp, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { checkCode } from "@/lib/services/vouchers";

// Codes carry 80 bits of randomness and this is limited per IP, so guessing
// one is not practical. Order creation re-checks the code atomically anyway.
export async function POST(request: Request) {
  if (!rateLimit(`voucher-check:${clientIp(request)}`, 10, 15 * 60_000)) {
    return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.slice(0, 40) : "";
  try {
    const result = await checkCode(await getRepo(), code, todayInBusinessTz());
    return json(result, result.ok ? 200 : 400);
  } catch (err) {
    return errorResponse(err);
  }
}
