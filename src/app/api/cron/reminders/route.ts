import { BUSINESS } from "@/lib/config";
import { errorResponse, json, lightDeps } from "@/lib/http";
import { runReminders } from "@/lib/services/orders";
import { safeEqual } from "@/lib/services/tokens";

// Vercel Cron calls this daily (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(auth, `Bearer ${secret}`)) {
    return json({ error: "Unauthorised" }, 401);
  }
  try {
    const result = await runReminders(await lightDeps(request), process.env.PICKUP_DETAILS || BUSINESS.pickupDetailsPlaceholder);
    return json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
