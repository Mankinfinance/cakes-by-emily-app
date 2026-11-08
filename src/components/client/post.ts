// Small fetch helper for the customer's buttons.
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T & { ok?: boolean }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data;
}
