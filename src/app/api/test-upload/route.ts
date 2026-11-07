import { cookies } from "next/headers";
import { memoryRepository } from "@/lib/data/memory";
import { TEST_ADMIN_COOKIE, testAuthBypassEnabled, testRoutesEnabled } from "@/lib/test-mode";

// Stands in for Supabase's signed upload URL in memory mode only.
export async function PUT(request: Request) {
  if (!testRoutesEnabled()) return new Response("Not found", { status: 404 });
  const jar = await cookies();
  if (!(testAuthBypassEnabled() && jar.get(TEST_ADMIN_COOKIE)?.value === "1")) {
    return new Response("Unauthorised", { status: 401 });
  }
  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const type = url.searchParams.get("type") ?? "application/octet-stream";
  if (!/^orders\/[0-9a-f-]{36}\/update-[0-9a-f-]{36}\.(mp4|mov|webm)$/.test(path)) {
    return new Response("Bad path", { status: 400 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  await memoryRepository.uploadMedia(path, { bytes, contentType: type });
  return new Response(null, { status: 204 });
}
