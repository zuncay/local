"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Dict } from "@/lib/i18n";
import { CreditControl, mapStyle } from "./Map";

export type PickPoint = { lat: number; lon: number };

type Props = {
  /** Where to look; changing `focusKey` flies there again (e.g. "use my location"). */
  center: PickPoint;
  zoom?: number;
  focusKey?: number;
  onChange: (p: PickPoint) => void;
  t: Dict;
};

/** Drag the map under a fixed pin to choose a point. */
export default function MapPicker({ center, zoom = 16, focusKey = 0, onChange, t }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: mapStyle(),
      center: [center.lon, center.lat],
      zoom,
      attributionControl: false,
      locale: { "NavigationControl.ZoomIn": t.mapZoomIn, "NavigationControl.ZoomOut": t.mapZoomOut, "Map.Title": t.mapLabel },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new CreditControl(t.mapCredit), "bottom-right");
    const report = () => {
      const c = map.getCenter();
      onChangeRef.current({ lat: c.lat, lon: c.lng });
    };
    map.on("moveend", report);
    mapRef.current = map;
    report();
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusKey) mapRef.current?.flyTo({ center: [center.lon, center.lat], zoom, duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return (
    <div className="absolute inset-0">
      <div ref={ref} className="h-full w-full" aria-label={t.mapLabel} />
      {/* The pin stays in the middle; its tip marks the chosen point. */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full" aria-hidden>
        <svg width="34" height="44" viewBox="0 0 34 44">
          <path d="M17 43s15-14.6 15-26A15 15 0 0 0 2 17c0 11.4 15 26 15 26z" fill="#f28c38" stroke="#fff" strokeWidth="2.5" />
          <circle cx="17" cy="17" r="5.5" fill="#fff" />
        </svg>
      </div>
    </div>
  );
}
