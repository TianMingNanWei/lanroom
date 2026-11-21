import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource, type Map as WorldMap } from "maplibre-gl";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import type { MapCity, MapCountry, MapMember } from "./api";
import { alphaFromId } from "./iso";

// OpenFreeMap Positron: public vector tiles, no API key.
const style = "https://tiles.openfreemap.org/styles/positron";

export function MapView({
  countries,
  cities,
  members,
  showLogins,
  onSelect,
}: {
  countries: MapCountry[];
  cities: MapCity[];
  members: MapMember[];
  showLogins: boolean;
  onSelect: (member: MapMember) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const mapRef = useRef<WorldMap | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!node.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: node.current,
      style,
      center: [20, 20],
      zoom: 1.3,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
      const shapes = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
      const before = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
      map.addSource("countries", { type: "geojson", data: shapes });
      map.addLayer({
        id: "country-fill",
        type: "fill",
        source: "countries",
        paint: { "fill-color": "#c2410c", "fill-opacity": 0.08 },
      }, before);
      map.addSource("cities", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "cities",
        type: "circle",
        source: "cities",
        paint: {
          "circle-color": "#f59e0b",
          "circle-opacity": 0.75,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff",
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 6, 20, 22],
        },
      });
      map.addSource("members", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "members",
        type: "circle",
        source: "members",
        paint: { "circle-color": "#1c1915", "circle-radius": 5, "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
      });
    });
    map.on("click", "members", (event) => {
      const found = event.features?.[0];
      const props = found?.properties as MapMember | undefined;
      if (props) selectRef.current(props);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const counts = new Map(countries.map((item) => [item.country, item.count]));
      const max = Math.max(1, ...countries.map((item) => item.count));
      const countrySource = map.getSource("countries") as GeoJSONSource | undefined;
      if (countrySource) {
        const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
        const shapes = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
        shapes.features.forEach((shape) => {
          const code = alphaFromId(String(shape.id ?? ""));
          const count = counts.get(code) || 0;
          (shape.properties as { opacity?: number }).opacity = count ? 0.18 + 0.7 * (count / max) : 0.05;
        });
        countrySource.setData(shapes);
        map.setPaintProperty("country-fill", "fill-opacity", ["get", "opacity"]);
      }
      const points = showLogins ? [] : members.filter((item) => item.lat != null && item.lon != null);
      (map.getSource("members") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: points.map((item) => ({
          type: "Feature",
          properties: item,
          geometry: { type: "Point", coordinates: [item.lon as number, item.lat as number] },
        })),
      });
      (map.getSource("cities") as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: cities.map((item) => ({
          type: "Feature",
          properties: item,
          geometry: { type: "Point", coordinates: [item.lon, item.lat] },
        })),
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [countries, cities, members, showLogins]);

  return <div ref={node} className="h-[calc(100vh-11rem)] min-h-[520px] overflow-hidden rounded-xl border" />;
}
