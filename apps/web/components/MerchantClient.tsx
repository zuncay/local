"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { shortAddr, usdc } from "@/lib/format";
import { merchantName } from "@/lib/i18n";
import Icon from "./Icon";
import { useI18n } from "./I18nProvider";
import Scanner from "./Scanner";
import { errorText } from "@/lib/error-text";
import QRVoucher from "./QRVoucher";
import { venuePayload } from "@/lib/venue-qr";
import { connectWallet, getSession, SESSION_EVENT, type CircleSession } from "@/lib/circle-client";
import type { MapPlace } from "@/lib/types";

type Merchant = { id: string; name: string; walletAddress: string; prepay?: boolean };
type Detail = {
  merchant: Merchant;
  balance: string | null;
  revenueUsdc: string;
  explorerUrl: string | null;
  released: { id: string; name: string; priceUsdc: string; releaseTx: string | null; checkedInAt: string | null }[];
};
type Result = { ok: true; name: string; amount: string; txHash: string; url: string | null } | { ok: false; message: string };

const MERCHANT_KEY = "toura.merchant";

/** toura://checkin?s={stopId}&c={code hex} → { stopId, code } (the code the escrow checks) */
function parsePayload(text: string): { stopId: string; code: string } | null {
  const m = text.trim().match(/^toura:\/\/checkin\?(.+)$/);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const stopId = q.get("s");
  const code = q.get("c");
  return stopId && code && /^[0-9a-f]{64}$/i.test(code) ? { stopId, code } : null;
}

export default function MerchantClient() {
  const { t } = useI18n();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState<string>("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [paste, setPaste] = useState("");
  const lastScan = useRef<{ text: string; at: number } | null>(null);
  const [session, setSession] = useState<CircleSession | null>(null);
  const [listed, setListed] = useState(false);
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    const sync = () => setSession(getSession());
    sync();
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);

  // The venues paid to the signed-in wallet.
  const wallet = session?.walletAddress ?? null;
  const loadMine = useCallback(
    async (prefer?: string) => {
      if (!wallet) {
        setMerchants([]);
        setMerchantId("");
        setListed(true);
        return;
      }
      try {
        const j = (await (await fetch(`/api/merchant?wallet=${wallet}`, { cache: "no-store" })).json()) as { merchants: Merchant[] };
        const list = j.merchants ?? [];
        setMerchants(list);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(MERCHANT_KEY);
        } catch {
          /* ignore */
        }
        setMerchantId(list.find((m) => m.id === (prefer ?? saved))?.id ?? list[0]?.id ?? "");
      } catch {
        setMerchants([]);
      } finally {
        setListed(true);
      }
    },
    [wallet],
  );
  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const signIn = async () => {
    try {
      const s = await connectWallet("/merchant");
      if (s) setSession(s);
    } catch {
      /* the chooser shows its own errors */
    }
  };

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    const res = await fetch(`/api/merchant?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, []);

  useEffect(() => {
    void loadDetail(merchantId);
    try {
      if (merchantId) localStorage.setItem(MERCHANT_KEY, merchantId);
    } catch {
      /* ignore */
    }
  }, [merchantId, loadDetail]);

  const checkin = useCallback(
    async (text: string) => {
      // html5-qrcode fires repeatedly for the same code; ignore duplicates for 5s.
      const now = Date.now();
      if (processing || (lastScan.current && lastScan.current.text === text && now - lastScan.current.at < 5000)) return;
      lastScan.current = { text, at: now };

      const parsed = parsePayload(text);
      if (!parsed) {
        setResult({ ok: false, message: t.scanInvalid });
        return;
      }
      setProcessing(true);
      setResult(null);
      try {
        const res = await fetch("/api/checkin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...parsed, merchantId }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const e = (j as { error?: { code?: string; message?: string } }).error;
          setResult({ ok: false, message: errorText(t, e?.code ?? "TX_FAILED", e?.message) });
          return;
        }
        const ok = j as { stop: { name: string; amountUsdc: string }; txHash: string; explorerTxUrl: string | null };
        setResult({ ok: true, name: ok.stop.name, amount: ok.stop.amountUsdc, txHash: ok.txHash, url: ok.explorerTxUrl });
        setPaste("");
        void loadDetail(merchantId);
      } catch {
        setResult({ ok: false, message: t.err.NETWORK });
      } finally {
        setProcessing(false);
      }
    },
    [merchantId, processing, loadDetail, t],
  );

  const onPaste = (e: FormEvent) => {
    e.preventDefault();
    lastScan.current = null;
    void checkin(paste);
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-5">
      <h1 className="flex items-center gap-2.5 font-display text-xl font-extrabold text-white">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden>
          <Icon name="store" size={19} />
        </span>
        {t.merchantTitle}
      </h1>

      {!wallet ? (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-ink-2">{t.merchantSignIn}</p>
          <button type="button" onClick={() => void signIn()} className="min-h-11 rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink">
            {t.merchantSignInBtn}
          </button>
        </section>
      ) : (
        <>
      {merchants.length > 0 && (
      <div className="space-y-2">
        <h2 id="merchant-pick" className="text-sm font-medium text-ink-2">
          {t.merchantSelect}
        </h2>
        <div role="radiogroup" aria-labelledby="merchant-pick" className="grid gap-2">
          {merchants.map((m) => {
            const on = m.id === merchantId;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setMerchantId(m.id);
                  setResult(null);
                }}
                className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                  on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent/40"
                }`}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${on ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2"}`}
                  aria-hidden
                >
                  <Icon name="store" size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-white">{merchantName(t, m)}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-2">
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${m.prepay ? "bg-warn-soft text-warn" : "bg-surface-2 text-[#c5d8d1]"}`}>
                      {m.prepay ? t.payModeEscrow : t.payModeVenue}
                    </span>
                    <span className="truncate tabular-nums">{shortAddr(m.walletAddress)}</span>
                  </span>
                </span>
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${on ? "border-accent bg-accent text-accent-ink" : "border-[#2c4b45]"}`}
                  aria-hidden
                >
                  {on && <Icon name="check" size={14} strokeWidth={2.6} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      )}
      {listed && merchants.length === 0 && <p className="text-sm text-ink-2">{t.merchantNone}</p>}
      {listed && (merchants.length === 0 || registering ? (
        <RegisterVenue
          session={session!}
          onDone={(m) => {
            setRegistering(false);
            void loadMine(m.id);
          }}
        />
      ) : (
        <button type="button" onClick={() => setRegistering(true)} className="min-h-11 text-sm font-semibold text-accent underline">
          + {t.regAdd}
        </button>
      ))}
        </>
      )}

      {detail && wallet && merchantId && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-line bg-surface p-3">
            <div className="text-xs text-ink-2">{t.merchantRevenue}</div>
            <div className="text-lg font-bold text-ink">{usdc(detail.revenueUsdc)}</div>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-3">
            <div className="text-xs text-ink-2">{t.merchantBalance}</div>
            <div className="text-lg font-bold text-ink">{detail.balance !== null ? usdc(Number(detail.balance).toFixed(2)) : "—"}</div>
            {detail.explorerUrl ? (
              <a
                href={`${detail.explorerUrl}/address/${detail.merchant.walletAddress}`}
                target="_blank"
                rel="noreferrer"
                className="-mb-2 inline-flex min-h-10 items-center tabular-nums text-xs text-accent underline"
              >
                {shortAddr(detail.merchant.walletAddress)} ↗
              </a>
            ) : (
              <span className="tabular-nums text-[11px] text-ink-2">{shortAddr(detail.merchant.walletAddress)}</span>
            )}
          </div>
        </section>
      )}

      {merchantId && wallet && (
        <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <div>
            <h2 className="font-bold text-ink">{t.venueQrTitle}</h2>
            <p className="mt-0.5 text-xs text-ink-2">{t.venueQrHint}</p>
          </div>
          <div className="flex justify-center">
            <QRVoucher
              payload={venuePayload(merchantId)}
              label={merchantName(t, merchants.find((m) => m.id === merchantId))}
              hint={t.venueQrCaption}
              download={`toura-venue-${merchantId}.png`}
              showText={false}
            />
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="font-bold text-ink">{t.scanGuestQr}</h2>
        <Scanner onScan={(text) => void checkin(text)} disabled={!merchantId} />
        <form onSubmit={onPaste} className="space-y-2">
          <label htmlFor="qr-paste" className="text-xs text-ink-2">
            {t.scanPaste}
          </label>
          <div className="flex gap-2">
            <input
              id="qr-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={t.pastePlaceholder}
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 tabular-nums text-base text-ink"
            />
            <button
              type="submit"
              disabled={processing || !paste.trim() || !merchantId}
              className="min-h-[44px] rounded-xl bg-ink px-4 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {t.scanSubmit}
            </button>
          </div>
        </form>

        {processing && (
          <p role="status" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
            {t.scanProcessing}
          </p>
        )}
        {result &&
          (result.ok ? (
            <div role="status" className="space-y-1 rounded-xl bg-ok-soft p-3 text-sm text-ok">
              <div className="font-bold">
                ✅ {t.scanSuccess} {usdc(result.amount)} — {result.name}
              </div>
              {result.url ? (
                <a href={result.url} target="_blank" rel="noreferrer" className="text-xs break-all underline">
                  {result.txHash} ↗
                </a>
              ) : (
                <code className="text-xs break-all">{result.txHash}</code>
              )}
            </div>
          ) : (
            <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
              {result.message}
            </p>
          ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink">{t.releasedList}</h2>
        {!detail || detail.released.length === 0 ? (
          <p className="text-sm text-ink-2">{t.none}</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {detail.released.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate text-ink">{r.name}</span>
                {r.releaseTx && detail.explorerUrl ? (
                  <a href={`${detail.explorerUrl}/tx/${r.releaseTx}`} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-accent">
                    {usdc(r.priceUsdc)} ↗
                  </a>
                ) : (
                  <span className="shrink-0 font-semibold text-ink">{usdc(r.priceUsdc)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Pick your place from the map data around you and register it to your wallet. */
function RegisterVenue({ session, onDone }: { session: CircleSession; onDone: (m: Merchant) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "locating" | "loading" | "ok" | "nogps" | "error">("idle");
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState<MapPlace | null>(null);
  const [prepay, setPrepay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const find = () => {
    setMsg(null);
    setPick(null);
    if (!("geolocation" in navigator)) return setState("nogps");
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setState("loading");
        try {
          const { latitude: lat, longitude: lon } = pos.coords;
          const res = await fetch(`/api/places?lat=${lat}&lon=${lon}&radius=500`, { cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          const j = (await res.json()) as { places: MapPlace[] };
          setPlaces([...j.places].sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0)));
          setState("ok");
        } catch {
          setState("error");
        }
      },
      () => setState("nogps"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const submit = async () => {
    if (!pick) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userToken: session.userToken, osmId: pick.osmId, lat: pick.lat, lon: pick.lon, prepay }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = (j as { error?: { code?: string; message?: string } }).error;
        setMsg({ ok: false, text: errorText(t, e?.code, e?.message) });
        return;
      }
      setMsg({ ok: true, text: t.regDone });
      onDone((j as { merchant: Merchant }).merchant);
    } catch {
      setMsg({ ok: false, text: t.err.NETWORK });
    } finally {
      setBusy(false);
    }
  };

  const q = filter.trim().toLowerCase();
  const shown = places.filter((p) => !p.merchantId && (!q || p.name.toLowerCase().includes(q)));

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-bold text-ink">{t.regTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-2">{t.regHint}</p>
      </div>
      <button
        type="button"
        onClick={find}
        disabled={state === "locating" || state === "loading"}
        className="min-h-11 rounded-xl border border-accent/50 px-4 text-sm font-semibold text-accent disabled:opacity-50"
      >
        {state === "locating" || state === "loading" ? "…" : t.regFind}
      </button>
      {state === "nogps" && <p className="text-sm text-warn">{t.regNoGps}</p>}
      {state === "error" && <p className="text-sm text-danger">{t.poiError}</p>}
      {state === "ok" && (
        <div className="space-y-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t.regFilter}
            aria-label={t.regFilter}
            className="min-h-[44px] w-full rounded-xl border border-line bg-bg px-3 text-base text-ink"
          />
          {shown.length === 0 ? (
            <p className="text-sm text-ink-2">{t.regEmpty}</p>
          ) : (
            <div role="radiogroup" aria-label={t.regTitle} className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {shown.map((p) => {
                const on = pick?.osmId === p.osmId;
                return (
                  <button
                    key={p.osmId}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPick(p)}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${on ? "border-accent bg-accent-soft" : "border-line bg-bg hover:border-accent/40"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{p.name}</span>
                      <span className="text-xs text-ink-2">
                        {t.category[p.category] ?? p.category} · {p.distanceM ?? 0} m
                      </span>
                    </span>
                    {on && <Icon name="check" size={16} strokeWidth={2.6} className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {pick && (
        <div className="space-y-3 border-t border-line pt-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={prepay} onChange={(e) => setPrepay(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]" />
            <span>
              <span className="block text-sm font-semibold text-ink">{t.regPrepay}</span>
              <span className="block text-xs text-ink-2">{t.regPrepayHint}</span>
            </span>
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="min-h-11 w-full rounded-xl bg-accent px-4 text-sm font-bold text-accent-ink disabled:opacity-50"
          >
            {busy ? "…" : `${t.regSubmit}: ${pick.name}`}
          </button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-danger/10 text-danger"}`}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
