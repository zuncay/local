"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_EMOJI, distance, hhmm } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
import { ARRIVE_M, LEAVE_M, readProgress, tripProgress, writeProgress, type LocalProgress } from "@/lib/live-trip";
import { directionsUrl } from "@/lib/stop-info";
import type { ItineraryView, StopView } from "@/lib/types";
import { useI18n } from "../I18nProvider";

const MapView = dynamic(() => import("../Map"), { ssr: false });

type Pos = { lat: number; lon: number; accuracy: number };
type GpsState = "locating" | "ok" | "off";

/** A stop the traveller still has to pay through Toura. */
const owes = (s: StopView) => (s.payMode === "ESCROW" || s.payMode === "VENUE") && (s.status === "PENDING" || s.status === "CHECKED_IN");

/**
 * The trip while it happens: the route with you on it, how far the next stop is,
 * and — once you are there — what to do (pay, or just enjoy and move on).
 */
export default function LiveTrip({ it }: { it: ItineraryView }) {
  const { t } = useI18n();
  const [local, setLocal] = useState<LocalProgress>({ seen: [], done: [] });
  useEffect(() => setLocal(readProgress(it.id)), [it.id]);
  const update = useCallback(
    (fn: (p: LocalProgress) => LocalProgress) =>
      setLocal((prev) => {
        const next = fn(prev);
        writeProgress(it.id, next);
        return next;
      }),
    [it.id],
  );

  const { doneIds, done, total, target } = tripProgress(it, local);

  // Follow the traveller while the trip is on.
  const [pos, setPos] = useState<Pos | null>(null);
  const [gps, setGps] = useState<GpsState>("locating");
  const hasTarget = !!target;
  useEffect(() => {
    if (!hasTarget) return;
    if (!("geolocation" in navigator)) return setGps("off");
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGps("ok");
        setPos({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => setGps("off"),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [hasTarget]);

  const meters = pos && target ? Math.round(haversineKm(pos, target) * 1000) : null;
  // A weak fix (indoors) gets a little more room, but never more than 150 m.
  const radius = pos ? Math.max(ARRIVE_M, Math.min(pos.accuracy, 150)) : ARRIVE_M;
  const manual = !!target && !!local.here?.includes(target.id);
  const atTarget =
    !!target && (manual || (local.seen.includes(target.id) ? meters === null || meters <= LEAVE_M : meters !== null && meters <= radius));

  // Arriving: remember it and buzz once. Leaving a stop with nothing to pay moves on.
  const buzzed = useRef<string | null>(null);
  useEffect(() => {
    if (!target || meters === null || !pos || local.here?.includes(target.id)) return;
    // Already at a later stop (went straight there, or opened the app on another
    // device): the ones before it are behind the traveller.
    if (meters > radius) {
      const from = it.stops.findIndex((s) => s.id === target.id);
      const ahead = it.stops.slice(from + 1).find((s) => !doneIds.includes(s.id) && haversineKm(pos, s) * 1000 <= radius);
      if (ahead) {
        const skipped = it.stops.slice(from, it.stops.indexOf(ahead)).map((s) => s.id);
        update((p) => ({ seen: [...p.seen, ahead.id], done: [...p.done, ...skipped] }));
        return;
      }
    }
    if (meters <= radius && !local.seen.includes(target.id)) {
      update((p) => ({ ...p, seen: [...p.seen, target.id] }));
      if (buzzed.current !== target.id) {
        buzzed.current = target.id;
        try {
          navigator.vibrate?.([120, 60, 120]);
        } catch {
          /* not supported */
        }
      }
    } else if (meters > LEAVE_M && local.seen.includes(target.id) && !owes(target)) {
      update((p) => ({ ...p, done: [...p.done, target.id] }));
    }
  }, [target?.id, meters, radius, local.seen, local.here, update]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (s: StopView) => update((p) => ({ ...p, done: [...p.done, s.id] }));
  // Without (good) GPS — indoors, a laptop, a demo — the traveller says they've arrived.
  const imHere = (s: StopView) => update((p) => ({ ...p, seen: [...p.seen, s.id], here: [...(p.here ?? []), s.id] }));
  const payNow = () => document.getElementById("pay-by-scan")?.scrollIntoView({ behavior: "smooth", block: "center" });

  const center = useMemo(() => ({ lat: it.stops[0].lat, lon: it.stops[0].lon }), [it.stops[0].lat, it.stops[0].lon]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useMemo(() => ({ doneIds, nextId: target?.id ?? null }), [doneIds.join(","), target?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const user = useMemo(() => (pos ? { lat: pos.lat, lon: pos.lon } : null), [pos?.lat, pos?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = total ? Math.round((done / total) * 100) : 0;
  const arrivedText = !target
    ? ""
    : owes(target)
      ? t.liveArrivedPay
      : target.payMode === "SELF" && Number(target.priceUsdc) > 0
        ? t.liveArrivedSelf
        : t.liveArrivedFree;

  return (
    <section id="live-trip" aria-label={t.liveTitle} className="scroll-mt-24 overflow-hidden rounded-[24px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2 text-[11px] font-extrabold tracking-[2px] text-accent">
          <span className="relative flex h-2.5 w-2.5" aria-hidden>
            {target && <span className="fx-ring absolute inset-0 rounded-full bg-accent" />}
            <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          {t.liveTitle.toUpperCase()}
        </div>
        <span className="text-xs font-semibold text-ink-2 tabular-nums">
          {t.liveProgress.replace("{done}", String(done)).replace("{total}", String(total))}
        </span>
      </div>
      <div className="mx-4 mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t.liveTitle}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>

      <div className="relative mt-4 h-[260px] md:h-[320px]" aria-label={t.liveMapLabel}>
        <MapView center={center} user={user} places={[]} itinerary={it} t={t} live={live} />
      </div>

      <div className="p-4" aria-live="polite">
        {!target ? (
          <p className="text-sm font-semibold text-accent">✓ {t.liveAllDone}</p>
        ) : atTarget ? (
          <div className="fx-rise space-y-3">
            <div>
              <div className="text-[11px] font-extrabold tracking-[2px] text-accent">🎉 {t.liveArrived.toUpperCase()}</div>
              <h3 className="mt-1 font-display text-xl leading-snug font-extrabold text-white">
                {CATEGORY_EMOJI[target.category] ?? "📍"} {target.name}
              </h3>
              <p className="mt-1 text-sm text-[#c5d8d1]">{arrivedText}</p>
            </div>
            {owes(target) ? (
              <>
                <button type="button" onClick={payNow} className="fx-shine min-h-12 w-full rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink">
                  {t.livePayNow}
                </button>
                <button type="button" onClick={() => finish(target)} className="min-h-10 w-full text-xs font-semibold text-ink-2 underline">
                  {t.liveSkip}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => finish(target)} className="min-h-12 w-full rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink">
                {t.liveGoOn} →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-ink-2">
                  {t.liveHeading} · {doneIds.length + 1}/{total}
                </div>
                <h3 className="mt-0.5 truncate font-display text-lg font-extrabold text-white">
                  {CATEGORY_EMOJI[target.category] ?? "📍"} {target.name}
                </h3>
                <p className="text-xs text-ink-2">{t.liveEta.replace("{time}", hhmm(target.arriveAt))}</p>
              </div>
              {meters !== null && (
                <div className="shrink-0 text-right">
                  <b className="block font-display text-2xl leading-none font-extrabold text-accent tabular-nums">{distance(meters)}</b>
                  <span className="text-[11px] text-ink-2">{t.liveToGo}</span>
                </div>
              )}
            </div>
            {gps !== "ok" && <p className={`text-xs ${gps === "off" ? "text-warn" : "text-ink-2"}`}>{gps === "off" ? t.liveNoGps : t.liveLocating}</p>}
            <div className="flex gap-2">
              <a
                href={directionsUrl(target)}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/15 text-sm font-bold text-white"
              >
                🧭 {t.directions} ↗
              </a>
              <button
                type="button"
                onClick={() => imHere(target)}
                className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent-soft text-sm font-bold text-accent"
              >
                📍 {t.liveImHere}
              </button>
            </div>
            <button type="button" onClick={() => finish(target)} className="min-h-10 w-full text-xs font-semibold text-ink-2 underline">
              {t.liveSkip}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
