import { getMemoryMedia } from "@/lib/data/memory";
import { testRoutesEnabled } from "@/lib/test-mode";

// Serves uploads in memory mode only. Production uses short-lived signed Supabase URLs.
export async function GET(request: Request) {
  if (!testRoutesEnabled()) return new Response("Not found", { status: 404 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  const file = getMemoryMedia(path);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: { "Content-Type": file.contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
