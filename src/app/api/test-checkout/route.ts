import { NextResponse } from "next/server";
import { lightDeps } from "@/lib/http";
import { handlePaidSession } from "@/lib/services/orders";
import { fakePaymentsAllowed } from "@/lib/services/payments";

// Simulates Stripe's "checkout.session.completed" webhook in memory mode only.
// It runs the exact same handler the real webhook uses.
export async function POST(request: Request) {
  if (!fakePaymentsAllowed()) return new Response("Not found", { status: 404 });
  const form = await request.formData();
  const session = String(form.get("session") ?? "");
  const origin = new URL(request.url).origin;
  let next = new URL("/", origin);
  try {
    const candidate = new URL(String(form.get("next") ?? "/"), origin);
    if (candidate.origin === origin) next = candidate;
  } catch {
    // keep default
  }
  if (!session.startsWith("cs_fake_")) return new Response("Bad session", { status: 400 });
  await handlePaidSession(await lightDeps(request), `evt_test_${session}`, session);
  return NextResponse.redirect(next, 303);
}
