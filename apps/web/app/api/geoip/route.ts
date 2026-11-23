import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/geoip → the visitor's approximate position from their network
 * (Vercel's edge geolocation headers), for when GPS is off or refused.
 * { lat: null } when unknown (e.g. local development).
 */
export function GET(req: Request) {
  const h = req.headers;
  const lat = Number(h.get("x-vercel-ip-latitude"));
  const lon = Number(h.get("x-vercel-ip-longitude"));
  const ok = h.has("x-vercel-ip-latitude") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return NextResponse.json(ok ? { lat, lon } : { lat: null, lon: null }, { headers: { "Cache-Control": "no-store" } });
}
