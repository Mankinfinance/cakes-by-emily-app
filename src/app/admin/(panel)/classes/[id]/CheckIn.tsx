"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkInAction } from "../../actions";

export function CheckIn({ bookingId, index, checkedIn, label }: { bookingId: string; index: number; checkedIn: boolean; label: string }) {
  const router = useRouter();
  const [on, setOn] = useState(checkedIn);
  const [pending, start] = useTransition();
  return (
    <input
      type="checkbox"
      className="h-5 w-5"
      checked={on}
      disabled={pending}
      aria-label={`Checked in: ${label}`}
      data-testid={`checkin-${label}`}
      onChange={(e) => {
        const next = e.target.checked;
        setOn(next);
        start(async () => {
          const r = await checkInAction(bookingId, index, next);
          if (!r.ok) setOn(!next);
          router.refresh();
        });
      }}
    />
  );
}
