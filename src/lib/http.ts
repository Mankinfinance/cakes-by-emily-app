import "server-only";
import { NextResponse } from "next/server";
import { siteUrl } from "./config";
import { getRepo } from "./data";
import { getMailer } from "./services/email";
import { OrderError } from "./services/orders";
import { getPayments, tryGetPayments } from "./services/payments";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(err: unknown) {
  if (err instanceof OrderError) return json({ error: err.message }, err.status);
  console.error(err);
  return json({ error: "Something went wrong. Please try again." }, 500);
}

export async function deps(request?: Request) {
  return {
    repo: await getRepo(),
    payments: getPayments(),
    mailer: getMailer(),
    baseUrl: siteUrl(request ? new URL(request.url).origin : undefined),
  };
}

export async function lightDeps(request?: Request) {
  return {
    repo: await getRepo(),
    mailer: getMailer(),
    payments: tryGetPayments(),
    baseUrl: siteUrl(request ? new URL(request.url).origin : undefined),
  };
}

export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
