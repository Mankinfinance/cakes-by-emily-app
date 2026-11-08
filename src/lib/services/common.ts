// Shared service types and helpers, kept separate so the services can use
// each other without circular imports.

import type { Repository } from "../data/repository";
import type { Mailer } from "./email";
import type { PaymentsGateway } from "./payments";
import { boxToken, linkToken, orderToken } from "./tokens";

export class OrderError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface Deps {
  repo: Repository;
  payments: PaymentsGateway;
  mailer: Mailer;
  baseUrl: string;
  now?: Date;
}

export type LightDeps = Omit<Deps, "payments">;

export const orderLink = (baseUrl: string, orderId: string) => `${baseUrl}/o/${orderToken(orderId)}`;
export const boxLink = (baseUrl: string, boxOrderId: string) => `${baseUrl}/b/${boxToken(boxOrderId)}`;
export const reviewLink = (baseUrl: string, orderId: string) => `${baseUrl}/review/${orderId}/${linkToken("review", orderId)}`;
export const corporateLink = (baseUrl: string, id: string) => `${baseUrl}/c/${linkToken("corporate", id)}`;
export const ticketLink = (baseUrl: string, id: string) => `${baseUrl}/t/${linkToken("booking", id)}`;
export const adminLink = (baseUrl: string, orderId: string) => `${baseUrl}/admin/orders/${orderId}`;

export function adminEmail(): string | null {
  return process.env.ADMIN_NOTIFY_EMAIL || null;
}

export function nowOf(deps: { now?: Date }): Date {
  return deps.now ?? new Date();
}
