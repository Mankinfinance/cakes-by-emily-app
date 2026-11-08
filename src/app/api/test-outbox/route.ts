import { json } from "@/lib/http";
import { outbox } from "@/lib/services/email";
import { testRoutesEnabled } from "@/lib/test-mode";

// Lets end-to-end tests read the emails that test mode "sent" (voucher codes,
// waitlist links). Only on the in-memory adapter, never in production.
export async function GET(request: Request) {
  if (!testRoutesEnabled()) return new Response("Not found", { status: 404 });
  const to = new URL(request.url).searchParams.get("to");
  return json(outbox().filter((e) => !to || e.to === to).map((e) => ({ to: e.to, subject: e.subject, text: e.text })));
}
