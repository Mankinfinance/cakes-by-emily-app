import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getRepo } from "@/lib/data";
import { addDays, formatDateLong, formatTime12, isIsoDate, todayInBusinessTz } from "@/lib/domain/dates";
import { kitchenRange, kitchenSheet } from "@/lib/domain/kitchen";
import { KitchenTick, PrintButton } from "./KitchenControls";

export default async function KitchenPage({ searchParams }: PageProps<"/admin/kitchen">) {
  await requireAdmin();
  const sp = await searchParams;
  const view = sp.view === "day" ? "day" : "week";
  const today = todayInBusinessTz();
  const date = typeof sp.date === "string" && isIsoDate(sp.date) ? sp.date : today;
  const { from, to } = kitchenRange(view, date);
  const repo = await getRepo();
  const [orders, boxes, corporate] = await Promise.all([repo.listOrders(), repo.listBoxOrders(), repo.listCorporateOrders()]);
  const days = kitchenSheet(orders, boxes, from, to, corporate);
  const step = view === "day" ? 1 : 7;
  const link = (d: string, v = view) => `/admin/kitchen?view=${v}&date=${d}`;

  return (
    <div className="kitchen-sheet">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl">Kitchen sheet</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className={`chip ${view === "day" ? "!bg-plum !text-white" : ""}`} href={link(date, "day")}>
            Day
          </Link>
          <Link className={`chip ${view === "week" ? "!bg-plum !text-white" : ""}`} href={link(date, "week")} data-testid="kitchen-week">
            Week
          </Link>
          <Link className="chip" href={link(addDays(date, -step))} aria-label="Previous">
            &lsaquo;
          </Link>
          <Link className="chip" href={link(today)}>
            Today
          </Link>
          <Link className="chip" href={link(addDays(date, step))} aria-label="Next" data-testid="kitchen-next">
            &rsaquo;
          </Link>
          <PrintButton />
        </div>
      </div>
      <p className="mt-1 text-muted">
        {from === to ? formatDateLong(from) : `${formatDateLong(from)} to ${formatDateLong(to)}`}, in pickup order
      </p>

      {days.length === 0 ? (
        <p className="mt-8 text-muted">Nothing to make in this period.</p>
      ) : (
        <div className="mt-6 grid gap-6" data-testid="kitchen">
          {days.map((d) => (
            <section key={d.date} className="kitchen-day">
              <h2 className="font-serif text-xl">{formatDateLong(d.date)}</h2>
              <ul className="mt-2 grid gap-2">
                {d.lines.map((l) => (
                  <li key={l.id} className={`card flex gap-3 p-3 text-sm ${l.done ? "opacity-60" : ""}`} data-testid={`kitchen-${l.reference}`}>
                    <KitchenTick kind={l.kind} id={l.id} done={l.done} label={l.reference} />
                    <div className="flex-1">
                      <p className="font-semibold">
                        {formatTime12(l.time)} &middot; {l.customerFirstName} <span className="font-normal text-muted">{l.reference}</span>
                      </p>
                      {l.kind === "cake" ? (
                        <>
                          <p>
                            {l.size}, {l.flavour}, {l.finish}, {l.colour}
                          </p>
                          {l.decorations.length > 0 && <p className="text-muted">Decorations: {l.decorations.join(", ")}</p>}
                          {l.extras.length > 0 && <p className="text-muted">Extras: {l.extras.join(", ")}</p>}
                          {l.topperText && <p>Topper: &ldquo;{l.topperText}&rdquo;</p>}
                          {l.noPhotos && (
                            <p className="mt-1 inline-block rounded-md border-2 border-plum px-2 py-0.5 text-xs font-semibold" data-testid="no-photos">
                              NO PHOTOS: please don&apos;t photograph or post this cake
                            </p>
                          )}
                          {(l.allergyNotes || l.dietary.length > 0) && (
                            <p className="allergy mt-1 rounded-md bg-rose px-2 py-1 font-semibold text-white" data-testid="allergy">
                              ALLERGIES: {[...l.dietary, l.allergyNotes].filter(Boolean).join(". ")}
                            </p>
                          )}
                        </>
                      ) : l.kind === "box" ? (
                        <p>
                          {l.quantity} x {l.name}
                        </p>
                      ) : (
                        <>
                          <p>
                            Corporate: {l.name} for {l.company}
                          </p>
                          <p className="text-muted">{l.hasLogo ? "Logo uploaded (see the order in Corporate)" : "No logo uploaded"}</p>
                          {l.notes && <p className="text-muted">Notes: {l.notes}</p>}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
