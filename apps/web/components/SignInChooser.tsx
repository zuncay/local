"use client";

import { useEffect, useRef, useState } from "react";
import { SIGNIN_CHOOSE_EVENT, type SignInMethod } from "@/lib/circle-client";
import Icon from "./Icon";
import { useI18n } from "./I18nProvider";

type Detail = { resolve: (m: SignInMethod | null) => void; handled: boolean };

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Asked whenever someone signs in with Google configured: Google, or a PIN wallet in this browser. */
export default function SignInChooser() {
  const { t } = useI18n();
  const pending = useRef<((m: SignInMethod | null) => void) | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<Detail>).detail;
      detail.handled = true;
      pending.current?.(null);
      pending.current = detail.resolve;
      setOpen(true);
    };
    window.addEventListener(SIGNIN_CHOOSE_EVENT, onAsk);
    return () => window.removeEventListener(SIGNIN_CHOOSE_EVENT, onAsk);
  }, []);

  const choose = (m: SignInMethod | null) => {
    setOpen(false);
    const resolve = pending.current;
    pending.current = null;
    resolve?.(m);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && choose(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const option = "flex min-h-[72px] w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors";
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center" onClick={() => choose(null)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-t-[24px] border border-line bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:max-w-md md:rounded-[24px] md:pb-5"
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 id="signin-title" className="font-display text-lg font-extrabold text-white">
            {t.signInTitle}
          </h2>
          <button type="button" onClick={() => choose(null)} className="-mr-2 min-h-10 rounded-lg px-3 text-sm text-ink-2 hover:text-white">
            {t.closeAction}
          </button>
        </div>
        <p className="mb-4 text-sm text-ink-2">{t.signInBody}</p>
        <div className="space-y-2.5">
          <button type="button" onClick={() => choose("google")} className={`${option} border-white/15 bg-white text-[#1f1f1f] hover:bg-[#f2f2f2]`}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white ring-1 ring-black/10">
              <GoogleMark />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{t.signInGoogle}</span>
              <span className="mt-0.5 block text-xs text-[#5f6368]">{t.signInGoogleNote}</span>
            </span>
          </button>
          <button type="button" onClick={() => choose("pin")} className={`${option} border-line bg-surface-2 text-white hover:border-accent/50`}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon name="shield" size={20} />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">{t.signInPin}</span>
              <span className="mt-0.5 block text-xs text-ink-2">{t.signInPinNote}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
