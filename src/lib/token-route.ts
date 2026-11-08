import "server-only";
import { z } from "zod";
import { clientIp, errorResponse, json, lightDeps } from "./http";
import { orderFromToken } from "./orders-public";
import { rateLimit } from "./rate-limit";
import type { Order } from "./domain/types";
import type { LightDeps } from "./services/common";

/**
 * Shared shape for the customer's order-link actions (approve, change, cancel):
 * rate limit, look the order up by its private token, parse the body, run.
 */
export async function orderAction<S extends z.ZodType>(
  request: Request,
  token: string,
  name: string,
  schema: S,
  run: (deps: LightDeps, order: Order, body: z.infer<S>) => Promise<unknown>,
) {
  if (!rateLimit(`${name}:${clientIp(request)}`, 15, 10 * 60_000)) {
    return json({ error: "Too many attempts. Please wait a few minutes." }, 429);
  }
  const order = await orderFromToken(token);
  if (!order) return json({ error: "Order not found." }, 404);
  let raw: unknown = {};
  try {
    const text = await request.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Please check your details." }, 400);
  try {
    const result = await run(await lightDeps(request), order, parsed.data);
    return json({ ok: true, ...(result && typeof result === "object" ? result : {}) });
  } catch (err) {
    return errorResponse(err);
  }
}
