import { connection } from "next/server";
import { notFound } from "next/navigation";
import { formatAud } from "@/lib/domain/money";
import { fakePaymentsAllowed } from "@/lib/services/payments";

// A pretend checkout used only by automated tests (memory adapter, no Stripe key).
export default async function TestCheckout({ searchParams }: PageProps<"/checkout/test">) {
  await connection();
  if (!fakePaymentsAllowed()) notFound();
  const { session, amount, next } = await searchParams;
  return (
    <main className="mx-auto max-w-md flex-1 px-4 py-16">
      <div className="card p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-rose">Test mode, no real money</p>
        <h1 className="mt-2 font-serif text-2xl">Test checkout</h1>
        <p className="mt-2">Amount: {formatAud(Number(amount) || 0)}</p>
        <form action="/api/test-checkout" method="post" className="mt-6">
          <input type="hidden" name="session" value={String(session ?? "")} />
          <input type="hidden" name="next" value={String(next ?? "/")} />
          <button className="btn btn-primary w-full" data-testid="test-pay">
            Pay (test)
          </button>
        </form>
      </div>
    </main>
  );
}
