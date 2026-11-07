import { TRACKER_STAGES, stageIndex, stageLabel } from "@/lib/domain/stages";
import type { Stage } from "@/lib/domain/types";

export function Tracker({ stage }: { stage: Stage }) {
  if (stage === "cancelled") {
    return <p className="rounded-xl bg-blush px-4 py-3 font-semibold" data-testid="tracker-cancelled">This order was cancelled.</p>;
  }
  const current = stage === "awaiting_payment" ? -1 : stageIndex(stage);
  const pct = current <= 0 ? 0 : (current / (TRACKER_STAGES.length - 1)) * 100;
  return (
    <div data-testid="tracker" data-stage={stage}>
      <div className="relative mb-2 h-1.5 rounded-full bg-blush" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full bg-rose transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <ol className="grid gap-3 sm:grid-cols-6 sm:gap-2">
        {TRACKER_STAGES.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className="flex items-center gap-3 sm:flex-col sm:text-center" aria-current={active ? "step" : undefined}>
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${
                  done ? "border-rose bg-rose text-white" : active ? "pulse border-rose bg-white text-rose" : "border-line bg-white text-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={`text-sm ${active ? "font-semibold text-plum" : done ? "text-plum" : "text-muted"}`}>{stageLabel(s)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
