import { prisma } from "./db";
import { haversineKm, type LatLon } from "./geo";
import { openDuringWindow } from "./hours";
import { normalizeVi } from "./landmarks";
import { ofmPois } from "./ofm-pois";
import { openingHoursFor, type OsmPoi } from "./overpass";
import { photonAreaPois, photonDishPois } from "./photon-pois";
import { CATEGORIES, unitPrice, type Category, type PriceSource } from "./pricing";

export type Place = {
  osmId: string;
  name: string;
  nameEn?: string;
  lat: number;
  lon: number;
  category: Category;
  openingHours?: string;
  cuisine?: string;
  tags?: string[];
  /** Per-person price in USDC. */
  priceUsdc: number;
  priceSource: PriceSource;
  merchantId?: string;
  suggestedMin?: number;
  source: "osm";
};

/** Old shared demo wallet; not a venue (old trips may still reference it). */
export const PARTNER_POOL_MERCHANT_ID = "m_partner";

/** Partner venues registered in the portal, by OSM id (cached briefly). */
let partnerCache: { at: number; byOsm: Map<string, string> } | null = null;
export function clearPartnerCache() {
  partnerCache = null;
}
async function partnersByOsm(): Promise<Map<string, string>> {
  if (partnerCache && Date.now() - partnerCache.at < 30_000) return partnerCache.byOsm;
  try {
    const rows = await prisma.merchant.findMany({ where: { id: { not: PARTNER_POOL_MERCHANT_ID } }, select: { id: true, osmId: true } });
    partnerCache = { at: Date.now(), byOsm: new Map(rows.map((m) => [m.osmId, m.id])) };
  } catch {
    partnerCache = { at: Date.now(), byOsm: new Map() };
  }
  return partnerCache.byOsm;
}

// Every place returned to the AI is remembered so build_itinerary can verify that
// the osmIds it receives were really returned by search_places (no invented POIs).
const known = new Map<string, Place>();

function remember(places: Place[]) {
  for (const p of places) known.set(p.osmId, p);
}

export type SearchParams = {
  lat: number;
  lon: number;
  radiusM: number;
  categories?: string[];
  limit?: number;
  windowStart?: Date;
  windowEnd?: Date;
  /** Max time to wait for Overpass opening hours. */
  osmWaitMs?: number;
  /** Name keyword (e.g. a dish: "phở", "cơm tấm") — searches food places by name. */
  keyword?: string;
  /** Interleave categories instead of pure distance order (for browsing). */
  mixCategories?: boolean;
};

export type SearchResult = Place & { distanceM: number; openDuringWindow: boolean | null };

function mixByCategory(list: SearchResult[]): SearchResult[] {
  const groups = new Map<string, SearchResult[]>();
  for (const p of list) groups.set(p.category, [...(groups.get(p.category) ?? []), p]);
  const queues = [...groups.values()];
  const out: SearchResult[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
  return out;
}

/** Keep the first occurrence of each OSM element (earlier lists win). */
function mergeOsm(...lists: OsmPoi[][]): OsmPoi[] {
  const byId = new Map<string, OsmPoi>();
  for (const l of lists) for (const p of l) if (!byId.has(p.osmId)) byId.set(p.osmId, p);
  return [...byId.values()];
}

export async function searchPlaces(params: SearchParams): Promise<SearchResult[]> {
  const { lat, lon } = params;
  const radiusM = Math.min(Math.max(params.radiusM, 300), 8000);
  const cats = (params.categories ?? []).filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c));
  const limit = Math.min(Math.max(params.limit ?? 15, 1), 40);
  const kw = params.keyword ? normalizeVi(params.keyword) : null;

  let osm: OsmPoi[];
  const tiles = ofmPois(lat, lon, radiusM); // reliable CDN source (OSM data, no opening hours)
  if (kw) {
    const fromTiles = (await tiles).filter(
      (p) => (p.category === "restaurant" || p.category === "cafe") && normalizeVi(p.name).includes(kw),
    );
    // Photon only as a supplement when the tiles have few matches.
    osm = fromTiles.length >= 5 ? fromTiles : mergeOsm(fromTiles, await photonDishPois(params.keyword!, lat, lon, radiusM));
  } else {
    // Tiles always; Photon (if configured/reachable) only when the tiles are thin.
    osm = await tiles;
    if (osm.length < 10) osm = mergeOsm(osm, await photonAreaPois(lat, lon, radiusM));
  }

  const partners = await partnersByOsm();
  const merged = new Map<string, Place>();
  for (const o of osm) {
    if (merged.has(o.osmId)) continue;
    // Some OSM "names" are really descriptions/reviews — not usable as a place name.
    if (o.name.length > 60) continue;
    const price = unitPrice({ category: o.category });
    merged.set(o.osmId, { ...o, priceUsdc: price.unit, priceSource: price.source, merchantId: partners.get(o.osmId), source: "osm" });
  }

  const here: LatLon = { lat, lon };
  let results: SearchResult[] = [...merged.values()]
    .map((p) => ({ ...p, distanceM: Math.round(haversineKm(here, p) * 1000), openDuringWindow: null as boolean | null }))
    .filter((p) => p.distanceM <= radiusM)
    .filter((p) => cats.length === 0 || cats.includes(p.category));

  // Partner venues first, then by distance.
  results.sort((a, b) => (!!a.merchantId === !!b.merchantId ? a.distanceM - b.distanceM : a.merchantId ? -1 : 1));
  if (params.mixCategories) results = mixByCategory(results);

  // Opening hours (tiles don't carry them): ask Overpass by id for the candidates only.
  results = results.slice(0, limit * 2);
  const needHours = results.filter((p) => !p.openingHours).map((p) => p.osmId);
  if (needHours.length) {
    const hours = await openingHoursFor(needHours, params.osmWaitMs ?? 4000);
    for (const p of results) if (!p.openingHours && hours.has(p.osmId)) p.openingHours = hours.get(p.osmId);
  }
  if (params.windowStart && params.windowEnd) {
    for (const p of results) p.openDuringWindow = openDuringWindow(p.openingHours, params.windowStart, params.windowEnd);
    // Spec: skip POIs whose opening_hours show they are closed during the window.
    results = results.filter((p) => p.openDuringWindow !== false);
  }
  results = results.slice(0, limit);
  remember(results);
  return results;
}

/** Places for the map layer: OSM around a point, no opening-hours filter. */
export async function placesForMap(lat: number, lon: number, radiusM: number, keyword?: string): Promise<SearchResult[]> {
  return searchPlaces({ lat, lon, radiusM, limit: 40, osmWaitMs: 3_000, keyword, mixCategories: !keyword });
}

/**
 * Look up a place the AI referenced. Only places previously returned by search are
 * accepted. After a server restart, re-search around the trip's starting point.
 */
export async function resolvePlace(osmId: string, near: LatLon): Promise<Place | null> {
  const hit = known.get(osmId);
  if (hit) return hit;
  await searchPlaces({ lat: near.lat, lon: near.lon, radiusM: 8000, limit: 40 });
  return known.get(osmId) ?? null;
}

/** A place near a point, for registering a venue (not limited to what the AI has seen). */
export async function findPlaceNear(osmId: string, near: LatLon): Promise<Place | null> {
  const hit = known.get(osmId);
  if (hit) return hit;
  // `near` is the place's own position: nearest-first within a few hundred metres finds it.
  const list = await searchPlaces({ lat: near.lat, lon: near.lon, radiusM: 400, limit: 40, osmWaitMs: 1_500 });
  return list.find((p) => p.osmId === osmId) ?? null;
}
