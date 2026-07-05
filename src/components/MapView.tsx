import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { MapPinPlus } from "lucide-react";
import type { LocationSummary, PhotoSummary } from "@searchit/shared";
import { previewUrl } from "../lib/api";
import { useTranslation } from "../lib/i18n";

interface MapViewProps {
  photos: PhotoSummary[];
  locations: LocationSummary[];
  onSelectPhoto: (photo: PhotoSummary) => void;
  isTagging: boolean;
  onMapClick: (lat: number, lon: number) => void;
}

const DEFAULT_CENTER: [number, number] = [0, 0];
const DEFAULT_ZOOM = 2;
const FOCUSED_ZOOM = 12;

// Brand blue for photos, brand ice for tagged locations -- distinct enough
// against the dark basemap and against each other.
function photoIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#4988C4;border:2px solid #071226;box-shadow:0 0 0 1px rgba(189,232,245,0.5);"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function locationIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: '<div style="width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#BDE8F5;border:2px solid #071226;box-shadow:0 0 0 1px rgba(189,232,245,0.5);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 16],
  });
}

export function MapView({
  photos,
  locations,
  onSelectPhoto,
  isTagging,
  onMapClick,
}: MapViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const onSelectPhotoRef = useRef(onSelectPhoto);
  const onMapClickRef = useRef(onMapClick);
  const isTaggingRef = useRef(isTagging);

  onSelectPhotoRef.current = onSelectPhoto;
  onMapClickRef.current = onMapClick;
  isTaggingRef.current = isTagging;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(
      DEFAULT_CENTER,
      DEFAULT_ZOOM,
    );
    // Dark basemap to match the app's theme (no API key required, unlike
    // Google Maps' dark style).
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 19,
      },
    ).addTo(map);
    map.on("click", (event: L.LeafletMouseEvent) => {
      if (!isTaggingRef.current) return;
      onMapClickRef.current(event.latlng.lat, event.latlng.lng);
    });
    markersLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const points: [number, number][] = [];

    for (const photo of photos) {
      if (photo.gpsLat === null || photo.gpsLon === null) continue;
      const point: [number, number] = [photo.gpsLat, photo.gpsLon];
      points.push(point);
      L.marker(point, { icon: photoIcon() })
        .addTo(layer)
        .bindPopup(
          `<div style="max-width:160px;font-family:'IBM Plex Sans',sans-serif">
            <img src="${previewUrl(photo.id)}" style="width:100%;border-radius:8px;margin-bottom:4px" />
            <div style="font-size:12px;color:#0F2854">${escapeHtml(photo.filename)}</div>
          </div>`,
        )
        .on("click", () => onSelectPhotoRef.current(photo));
    }

    for (const location of locations) {
      const point: [number, number] = [location.lat, location.lon];
      points.push(point);
      L.marker(point, { icon: locationIcon() })
        .addTo(layer)
        .bindPopup(
          `<b style="font-family:'IBM Plex Serif',serif;color:#0F2854">${escapeHtml(location.name)}</b>`,
        );
    }

    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points).pad(0.2), { maxZoom: FOCUSED_ZOOM });
    }
  }, [photos, locations]);

  return (
    <div className="relative flex-1">
      <div ref={containerRef} className="h-full w-full" />
      {isTagging && (
        <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <span className="flex items-center gap-1.5 rounded-full border border-navy-700 bg-navy-900/90 px-3 py-1 text-xs font-medium text-mist-100 shadow-lg">
            <MapPinPlus className="h-3.5 w-3.5 text-blue-400" />
            {t("map.tagHint")}
          </span>
        </div>
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
