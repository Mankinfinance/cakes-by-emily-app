import { errorResponse, json, lightDeps } from "@/lib/http";
import { runDaily } from "@/lib/services/changes";
import { safeEqual } from "@/lib/services/tokens";

// Vercel Cron calls this daily: releases abandoned checkouts, moves the waitlist
// along and sends the scheduled automatic messages.
// Vercel Cron calls it (see vercel.json) with "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16 || !safeEqual(auth, `Bearer ${secret}`)) {
    return json({ error: "Unauthorised" }, 401);
  }
  try {
    const result = await runDaily(await lightDeps(request));
    return json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
