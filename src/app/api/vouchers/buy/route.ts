import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { startVoucherPurchase } from "@/lib/services/vouchers";
import { voucherPurchaseSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`voucher-buy:${clientIp(request)}`, 6, 10 * 60_000)) {
    return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429);
  }
  const parsed = voucherPurchaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    const { checkoutUrl } = await startVoucherPurchase(await deps(request), parsed.data);
    return json({ checkoutUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
