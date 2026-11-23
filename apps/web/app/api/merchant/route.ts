import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson, parseQuery } from "@/lib/api";
import { nativeUsdcBalance } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { clearPartnerCache, findPlaceNear, PARTNER_POOL_MERCHANT_ID } from "@/lib/places";
import { rateLimit } from "@/lib/rate-limit";
import { walletForToken } from "@/lib/wallet-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ id: z.string().min(1).max(64).optional(), wallet: z.string().optional() });

/** GET /api/merchant?wallet= → venues paid to that wallet; GET /api/merchant?id= → wallet balance + released vouchers. */
export const GET = handle(async (req: Request) => {
  const { id, wallet } = parseQuery(req, Query);
  if (!id) {
    if (!wallet || !isAddress(wallet)) return NextResponse.json({ merchants: [] });
    // Addresses are stored checksummed; match case-insensitively to be safe.
    const all = await prisma.merchant.findMany({ where: { id: { not: PARTNER_POOL_MERCHANT_ID } }, orderBy: { name: "asc" } });
    return NextResponse.json({ merchants: all.filter((m) => m.walletAddress.toLowerCase() === wallet.toLowerCase()) });
  }
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) throw new ApiError(404, "NOT_FOUND", "Merchant not found");

  const released = await prisma.stop.findMany({
    where: { merchantId: id, status: "RELEASED" },
    orderBy: { checkedInAt: "desc" },
    take: 50,
    select: { id: true, name: true, priceUsdc: true, paidUsdc: true, payMode: true, releaseTx: true, checkedInAt: true },
  });
  let balance: string | null = null;
  try {
    balance = await nativeUsdcBalance(merchant.walletAddress as Address);
  } catch {
    balance = null; // chain not configured / RPC down — page still works
  }
  // Pay-at-venue stops record what was actually paid; prepaid stops pay their fixed price.
  const amountOf = (r: (typeof released)[number]) => (r.paidUsdc ?? r.priceUsdc).toString();
  const revenue = released.reduce((s, r) => s + Number(amountOf(r)), 0);
  return NextResponse.json({
    merchant,
    balance,
    revenueUsdc: revenue.toFixed(2),
    explorerUrl: config.explorerUrl ?? null,
    released: released.map((r) => ({ id: r.id, name: r.name, releaseTx: r.releaseTx, checkedInAt: r.checkedInAt, priceUsdc: amountOf(r) })),
  });
});

const Register = z.object({
  userToken: z.string().min(10).max(4000),
  osmId: z.string().min(3).max(64),
  // The place's own position (from the nearby list), to find it again on the server.
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  prepay: z.boolean().default(false),
});

/**
 * POST /api/merchant → a venue owner registers their place (any OSM place, anywhere).
 * Payments for it go to the signed-in wallet.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`merchant-register:${clientIp(req)}`, 10, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const body = await parseJson(req, Register);
  const wallet = await walletForToken(body.userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Sign in with your wallet first");
  const place = await findPlaceNear(body.osmId, { lat: body.lat, lon: body.lon });
  if (!place) throw new ApiError(404, "NOT_FOUND", "Place not found");
  const taken = await prisma.merchant.findUnique({ where: { osmId: place.osmId } });
  if (taken) throw new ApiError(409, "CONFLICT", "This place is already registered");
  const merchant = await prisma.merchant.create({
    data: {
      id: `v_${randomBytes(6).toString("hex")}`,
      name: place.name,
      osmId: place.osmId,
      walletAddress: getAddress(wallet),
      prepay: body.prepay,
    },
  });
  clearPartnerCache();
  return NextResponse.json({ merchant });
});

