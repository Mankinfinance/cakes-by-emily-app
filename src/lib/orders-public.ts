import "server-only";
import { getRepo } from "./data";
import { hashToken, looksLikeToken } from "./services/tokens";

/** Look up an order from its private link token. */
export async function orderFromToken(token: string) {
  if (!looksLikeToken(token)) return null;
  const repo = await getRepo();
  return repo.getOrderByTokenHash(hashToken(token));
}

/** Look up a seasonal box order from its private link token. */
export async function boxOrderFromToken(token: string) {
  if (!looksLikeToken(token)) return null;
  const repo = await getRepo();
  return repo.getBoxOrderByTokenHash(hashToken(token));
}
