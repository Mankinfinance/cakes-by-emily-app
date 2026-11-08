import { clientIp, deps, errorResponse, json } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { startPassPurchase } from "@/lib/services/passes";
import { passPurchaseSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (!rateLimit(`pass:${clientIp(request)}`, 6, 10 * 60_000)) return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  const parsed = passPurchaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    const { checkoutUrl } = await startPassPurchase(await deps(request), parsed.data);
    return json({ checkoutUrl });
  } catch (err) {
    return errorResponse(err);
  }
}
