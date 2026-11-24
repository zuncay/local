// A venue's fixed QR (printed at the counter). The traveller scans it to pay the
// stop at that venue: a prepaid stop is released with the check-in code from their
// device; a pay-at-venue stop is paid by a direct USDC transfer they confirm.
// It carries only the venue id — no secret — so it is safe to print.

/** Fired with a merchant id to pay that venue on this trip page right away (as if its QR was scanned). */
export const PAY_VENUE_EVENT = "toura-pay-venue";

export function venuePayload(merchantId: string): string {
  return `toura://venue?m=${encodeURIComponent(merchantId)}`;
}

export function parseVenue(text: string): string | null {
  const m = text.trim().match(/^toura:\/\/venue\?(.+)$/);
  if (!m) return null;
  const id = new URLSearchParams(m[1]).get("m");
  return id && /^[a-z0-9_-]{1,64}$/i.test(id) ? id : null;
}
