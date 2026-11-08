import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { formatDateLong, todayInBusinessTz } from "@/lib/domain/dates";
import { formatAud } from "@/lib/domain/money";
import { voidVoucherAction } from "../actions";
import { ActionButton } from "../ActionButton";
import { VoucherSettings } from "./VoucherSettings";

export default async function VouchersPage() {
  await requireAdmin();
  const repo = await getRepo();
  const [vouchers, settings] = await Promise.all([repo.listVouchers(), repo.getSettings()]);
  const today = todayInBusinessTz();
  const live = vouchers.filter((v) => v.status === "active" && v.expiresOn >= today);
  const outstanding = live.reduce((s, v) => s + v.balanceCents, 0);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-3xl">Gift vouchers and credit</h1>
        <p className="mt-1 text-sm text-muted">
          Gift vouchers are bought online. Credit codes are issued automatically when a cancellation leaves a customer with credit. Codes are
          never stored, only their last 4 characters, so only the customer&apos;s email has the full code.
        </p>
        <p className="mt-2 font-semibold" data-testid="outstanding">Outstanding balance: {formatAud(outstanding)}</p>
      </div>
      <VoucherSettings settings={settings} />
      <section className="card p-5">
        <h2 className="font-serif text-xl">All codes</h2>
        {vouchers.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm" data-testid="voucher-table">
              <thead className="text-muted">
                <tr>
                  <th className="py-1">Code</th>
                  <th>Type</th>
                  <th>For</th>
                  <th>Balance</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {vouchers.map((v) => (
                  <tr key={v.id}>
                    <td className="py-2 font-mono">...{v.codeLast4}</td>
                    <td>{v.kind === "gift" ? "Gift" : "Credit"}</td>
                    <td>{v.kind === "gift" ? `${v.recipientName} (from ${v.buyerName})` : v.buyerEmail}</td>
                    <td>
                      {formatAud(v.balanceCents)} of {formatAud(v.amountCents)}
                    </td>
                    <td>{formatDateLong(v.expiresOn)}</td>
                    <td>{v.status === "pending" ? "Unpaid" : v.status === "void" ? "Void" : v.expiresOn < today ? "Expired" : "Active"}</td>
                    <td>{v.status === "active" && <ActionButton action={voidVoucherAction.bind(null, v.id)} label="Void" confirmText="Void this code? It can't be used again." />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
