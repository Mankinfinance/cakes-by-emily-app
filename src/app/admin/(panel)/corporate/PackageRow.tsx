"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CorporatePackage } from "@/lib/domain/types";
import { updateCorporatePackageAction } from "../actions";

export function PackageRow({ pkg }: { pkg: CorporatePackage }) {
  const router = useRouter();
  const [price, setPrice] = useState(String(pkg.priceCents / 100));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Record<string, unknown>) =>
    start(async () => {
      const r = await updateCorporatePackageAction(pkg.id, patch);
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  return (
    <li className={`flex flex-wrap items-center justify-between gap-3 py-2 ${pkg.visible ? "" : "opacity-60"}`} data-testid={`corp-pkg-${pkg.id}`}>
      <span className="font-semibold">{pkg.name}</span>
      <span className="flex items-center gap-3 text-sm">
        <span>$</span>
        <input type="number" min={0} className="field !w-28 !py-1.5" value={price} onChange={(e) => setPrice(e.target.value)} aria-label={`Price for ${pkg.name}`} />
        <button type="button" className="btn btn-ghost !px-3 !py-1.5" disabled={pending} onClick={() => save({ priceCents: Math.round(Number(price) * 100) })}>
          Save
        </button>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={pkg.visible} disabled={pending} onChange={(e) => save({ visible: e.target.checked })} data-testid={`corp-visible-${pkg.id}`} />
          Show to customers
        </label>
      </span>
      {error && <span className="w-full text-xs text-rose-dark">{error}</span>}
    </li>
  );
}
