"use client";

import { useEffect, useRef, useState } from "react";
import { usdc } from "@/lib/format";
import { readProgress, tripProgress } from "@/lib/live-trip";
import type { ItineraryView, StopView } from "@/lib/types";
import { useI18n } from "../I18nProvider";
import Icon from "../Icon";

type Moment = { stop: StopView; done: number; total: number; next: StopView | null };

/**
 * The moment money reaches a venue: whenever a stop turns RELEASED while the page
 * is open (the traveller paid, or the venue scanned their code), celebrate it with
 * the amount, the trip's progress and the on-chain proof.
 */
export default function ReleaseMoment({ it, explorerUrl }: { it: ItineraryView; explorerUrl: string | null }) {
  const { t } = useI18n();
  const prev = useRef<Map<string, string> | null>(null);
  const [moment, setMoment] = useState<Moment | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(it.stops.map((s) => [s.id, s.status]));
    if (!before) return; // first render: only changes from now on
    // Only a real payment: the stop was waiting for it (not, say, a group view resolving).
    const fresh = it.stops.find((s) => s.status === "RELEASED" && ["PENDING", "CHECKED_IN"].includes(before.get(s.id) ?? ""));
    if (!fresh) return;
    const p = tripProgress(it, readProgress(it.id));
    setMoment({ stop: fresh, done: p.done, total: p.total, next: p.target });
  }, [it]);

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moment) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMoment(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moment]);

  if (!moment) return null;
  const { stop, done, total, next } = moment;
  const amount = stop.paidUsdc ?? stop.priceUsdc;
  const venue = stop.merchant?.name ?? stop.name;
  const close = () => {
    setMoment(null);
    if (next) document.getElementById("live-trip")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className="fx-backdrop fixed inset-0 z-[60] grid place-items-center bg-[#020a09cc] p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && setMoment(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-title"
        className="fx-rise w-full max-w-sm rounded-[28px] border border-accent/30 bg-gradient-to-b from-[#0f3a32] to-[#081d19] p-6 text-center shadow-[0_30px_90px_#000a]"
      >
        <div className="relative mx-auto grid h-20 w-20 place-items-center" aria-hidden>
          <span className="fx-ring absolute inset-0 rounded-full border-2 border-accent" />
          <span className="fx-ring-late absolute inset-0 rounded-full border-2 border-accent" />
          <span className="fx-pop relative grid h-16 w-16 place-items-center rounded-full bg-accent text-accent-ink">
            <Icon name="check" size={34} strokeWidth={3} />
          </span>
        </div>
        <p id="release-title" className="mt-5 text-[11px] font-extrabold tracking-[2px] text-accent">
          {(stop.payMode === "ESCROW" ? t.releaseEscrow : t.releaseVenue).toUpperCase()}
        </p>
        <p className="fx-pop mt-2 font-display text-[40px] leading-none font-extrabold text-white tabular-nums">{usdc(amount)}</p>
        <p className="mt-3 text-sm text-[#c5d8d1]">{t.releaseBody.replace("{name}", venue)}</p>

        <div className="mt-5 text-left">
          <div className="flex justify-between text-xs text-ink-2">
            <span>{next ? t.liveTitle : t.releaseTripDone}</span>
            <span className="tabular-nums">{t.liveProgress.replace("{done}", String(done)).replace("{total}", String(total))}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#ffffff14]">
            <div className="fx-grow h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((done / total) * 100) : 100}%` }} />
          </div>
        </div>

        {stop.releaseTx && explorerUrl && (
          <a
            href={`${explorerUrl}/tx/${stop.releaseTx}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-accent underline"
          >
            {t.releaseOnchain} ↗
          </a>
        )}

        <button
          ref={closeRef}
          type="button"
          onClick={close}
          className="fx-shine mt-4 min-h-12 w-full rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink"
        >
          {next ? t.releaseContinue.replace("{name}", next.name) : `${t.releaseTripDone} 🎉`}
        </button>
      </div>
    </div>
  );
}
