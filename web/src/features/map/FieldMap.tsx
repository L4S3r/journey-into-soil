import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { fmt } from "../../lib/msg";
import { useStore } from "../../state/store";

type Lookup = Awaited<ReturnType<typeof api.lookup>>;

export function FieldMap() {
  const { t } = useTranslation();
  const { request, setRequest, lang } = useStore();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const [info, setInfo] = useState<Lookup | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      center: [request.lon, request.lat],
      zoom: 7,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("click", (e) => setRequest({ lat: +e.lngLat.lat.toFixed(4), lon: +e.lngLat.lng.toFixed(4) }));
    marker.current = new maplibregl.Marker({ color: "#a2502f" }).setLngLat([request.lon, request.lat]).addTo(m);
    map.current = m;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([request.lon, request.lat]);
    map.current?.easeTo({ center: [request.lon, request.lat], duration: 500 });
    let live = true;
    api
      .lookup(request.lat, request.lon)
      .then((r) => live && setInfo(r))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [request.lat, request.lon]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" aria-label={t("ui.map_label")} />
      <p className="hint">{t("ui.map_hint")}</p>
      <p className="coords">
        {request.lat.toFixed(3)}°N, {request.lon.toFixed(3)}°E
        {info && (
          <>
            {" · "}
            {t(`ui.region.${info.region}`)}
            {" · "}
            {t("ui.lookup_summary", {
              tmax: fmt(lang, info.climate.mean_tmax, 1),
              rain: fmt(lang, info.climate.annual_rain_mm),
              et0: fmt(lang, info.climate.annual_et0_mm),
            })}
            {info.climate.source === "synthetic" && <span className="badge warn">{t("ui.placeholder_climate")}</span>}
          </>
        )}
      </p>
    </div>
  );
}
