import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, handle, jsonError, parseJson } from "@/lib/api";
import { refreshUserToken } from "@/lib/circle";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  userToken: z.string().min(10).max(4000),
  refreshToken: z.string().min(10).max(4000),
  deviceId: z.string().min(8).max(200),
});

/** Google sign-in: renew the session silently (Circle checks the refresh token against the user token). */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`circle-refresh:${clientIp(req)}`, 20, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const { userToken, refreshToken, deviceId } = await parseJson(req, Body);
  const r = await refreshUserToken(userToken, refreshToken, deviceId);
  return NextResponse.json({ userToken: r.userToken, encryptionKey: r.encryptionKey, refreshToken: r.refreshToken });
});
