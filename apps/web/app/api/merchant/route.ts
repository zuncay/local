import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { ApiError, clientIp, handle, jsonError, parseJson, parseQuery } from "@/lib/api";
import { nativeUsdcBalance } from "@/lib/chain";
import { prisma } from "@/lib/db";
import { config } from "@/lib/env";
import { normalizeVi } from "@/lib/landmarks";
import { clearPartnerCache, findPlaceNear, PARTNER_POOL_MERCHANT_ID, PORTAL_PLACE_PREFIX } from "@/lib/places";
import { CATEGORIES } from "@/lib/pricing";
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

const Register = z
  .object({
    userToken: z.string().min(10).max(4000),
    // A place on the map (OpenStreetMap)…
    osmId: z.string().min(3).max(64).optional(),
    // …or a new venue that isn't on the map yet: its name and kind.
    name: z.string().trim().min(2).max(60).optional(),
    category: z.enum(CATEGORIES).optional(),
    // The place's position (from the list), or where the owner put the pin for a new venue.
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    prepay: z.boolean().default(false),
  })
  .refine((b) => !!b.osmId || (!!b.name && !!b.category), { message: "osmId, or name and category, required" });

/**
 * POST /api/merchant → a venue owner registers their place: one on the map, or a new
 * venue at a point they choose. Payments for it go to the signed-in wallet.
 */
export const POST = handle(async (req: Request) => {
  if (!rateLimit(`merchant-register:${clientIp(req)}`, 10, 60_000).ok) return jsonError(429, "RATE_LIMITED", "Too many requests");
  const body = await parseJson(req, Register);
  const wallet = await walletForToken(body.userToken);
  if (!wallet) throw new ApiError(401, "WALLET_REQUIRED", "Sign in with your wallet first");
  const id = `v_${randomBytes(6).toString("hex")}`;

  let data: { name: string; osmId: string; lat: number; lon: number; category: string };
  if (body.osmId) {
    const place = await findPlaceNear(body.osmId, { lat: body.lat, lon: body.lon });
    if (!place) throw new ApiError(404, "NOT_FOUND", "Place not found");
    data = { name: place.name, osmId: place.osmId, lat: place.lat, lon: place.lon, category: place.category };
  } else {
    // The same name registered within ~100 m is almost certainly the same venue.
    const near = await prisma.merchant.findMany({
      where: { lat: { gte: body.lat - 0.001, lte: body.lat + 0.001 }, lon: { gte: body.lon - 0.001, lte: body.lon + 0.001 } },
    });
    const same = near.find((m) => normalizeVi(m.name) === normalizeVi(body.name!));
    if (same) throw new ApiError(409, "CONFLICT", "This place is already registered");
    data = { name: body.name!, osmId: `${PORTAL_PLACE_PREFIX}${id}`, lat: body.lat, lon: body.lon, category: body.category! };
  }
  const taken = await prisma.merchant.findUnique({ where: { osmId: data.osmId } });
  if (taken) throw new ApiError(409, "CONFLICT", "This place is already registered");
  const merchant = await prisma.merchant.create({ data: { id, ...data, walletAddress: getAddress(wallet), prepay: body.prepay } });
  clearPartnerCache();
  return NextResponse.json({ merchant });
});
