import type { ReactNode } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PhotoStatus } from "@searchit/shared";

export type Locale = "en" | "es";

const STORAGE_KEY = "searchit.locale";

const en = {
  "nav.photos": "Photos",
  "nav.people": "People",
  "nav.map": "Map",
  "header.tagLocation": "Tag a location",
  "header.tagLocationActive": "Click the map…",
  "header.newEvent": "New event",
  "header.backfill": "Backfill older photos",
  "header.server": "Server:",
  "similarity.banner": "Photos similar to your selection",
  "similarity.clear": "Clear",
  "people.back": "← Back to people",
  "people.unnamedPerson": "Unnamed person",
  "people.empty": "No people detected yet.",
  "people.unnamedPlaceholder": "Unnamed",
  "people.photoWord": "photo",
  "people.identifyByPhoto": "Identify by photo",
  "identify.title": "Identify a client",
  "identify.prompt": "Upload a clear photo of their face to find them among your archive.",
  "identify.chooseFile": "Choose photo",
  "identify.anotherFile": "Try another photo",
  "identify.matching": "Matching…",
  "identify.noFace": "No face detected in that photo. Try a clearer, front-facing shot.",
  "identify.noCandidates": "No matching people found yet.",
  "identify.matchPercent": "{percent}% match",
  "identify.viewPhotos": "View photos",
  "backfill.queuedOne": "Queued {count} older photo for reprocessing.",
  "backfill.queuedOther": "Queued {count} older photos for reprocessing.",
  "backfill.nothing":
    "Nothing to backfill -- every photo already has current data.",
  "map.tagHint": "Click the map to place the new location",
  "newEvent.title": "New event",
  "newEvent.name": "Name",
  "newEvent.namePlaceholder": "e.g. Montevideo 10K",
  "newEvent.date": "Date (optional)",
  "common.cancel": "Cancel",
  "common.creating": "Creating…",
  "common.create": "Create",
  "common.close": "Close",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.unknown": "Unknown",
  "photoDetail.loading": "Loading…",
  "photoDetail.regionHint":
    "Drag a box on the photo to find similar photos or link a missed face to a person.",
  "photoDetail.working": " Working…",
  "photoDetail.takenAt": "Taken at",
  "photoDetail.gps": "GPS coordinates",
  "photoDetail.noGps": "No GPS data",
  "photoDetail.camera": "Camera",
  "photoDetail.photoId": "Photo ID",
  "photoDetail.idPlaceholder": "e.g. 452",
  "photoDetail.status": "Status",
  "photoDetail.textInPhoto": "Text in photo",
  "photoDetail.peopleInPhoto": "People in this photo",
  "photoDetail.detectedFace": "Detected face",
  "photoDetail.notThisPerson": "Not this person",
  "photoDetail.revealOriginal": "Reveal original file",
  "photoDetail.reprocess": "Reprocess this photo",
  "region.findSimilar": "Find similar",
  "region.linkAsPerson": "Link as person",
  "results.empty": "No photos match these filters yet.",
  "results.unknownDate": "Unknown date",
  "header.watchDir": "Drop new photos into: {path}",
  "filters.photoId": "Photo ID",
  "filters.event": "Event",
  "filters.allEvents": "All events",
  "filters.from": "From",
  "filters.to": "To",
  "filters.location": "Location",
  "filters.anywhere": "Anywhere",
  "filters.radius": "Radius (km)",
  "filters.describe": "Describe what to find",
  "filters.describePlaceholder": "e.g. red shirt",
  "filters.sceneText": "Text visible in photo",
  "filters.sceneTextPlaceholder": "e.g. finish line",
  "filters.searching": "Searching…",
  "filters.search": "Search",
  "filters.refresh": "Refresh",
  "filters.refreshTitle": "Refresh results (picks up newly-arrived photos)",
  "tagLocation.title": "Tag a location",
  "tagLocation.name": "Name",
  "tagLocation.namePlaceholder": "e.g. Finish line",
  "tagLocation.latitude": "Latitude",
  "tagLocation.longitude": "Longitude",
  "tagLocation.save": "Save location",
  "status.pending": "pending",
  "status.processed": "processed",
  "status.failed": "failed",
  "update.check": "Check for updates",
  "update.checking": "Checking…",
  "update.upToDate": "You're on the latest version.",
  "update.available": "Version {version} is available.",
  "update.install": "Install and restart",
  "update.installing": "Installing…",
} as const;

export type TranslationKey = keyof typeof en;

const es: Record<TranslationKey, string> = {
  "nav.photos": "Fotos",
  "nav.people": "Personas",
  "nav.map": "Mapa",
  "header.tagLocation": "Marcar ubicación",
  "header.tagLocationActive": "Hacé clic en el mapa…",
  "header.newEvent": "Nuevo evento",
  "header.backfill": "Reprocesar fotos antiguas",
  "header.server": "Servidor:",
  "similarity.banner": "Fotos similares a tu selección",
  "similarity.clear": "Limpiar",
  "people.back": "← Volver a personas",
  "people.unnamedPerson": "Persona sin nombre",
  "people.empty": "Todavía no se detectaron personas.",
  "people.unnamedPlaceholder": "Sin nombre",
  "people.photoWord": "foto",
  "people.identifyByPhoto": "Identificar por foto",
  "identify.title": "Identificar a un cliente",
  "identify.prompt": "Subí una foto clara de su cara para encontrarlo en tu archivo.",
  "identify.chooseFile": "Elegir foto",
  "identify.anotherFile": "Probar con otra foto",
  "identify.matching": "Buscando coincidencias…",
  "identify.noFace": "No se detectó ninguna cara en esa foto. Probá con una toma más clara y de frente.",
  "identify.noCandidates": "Todavía no se encontraron coincidencias.",
  "identify.matchPercent": "{percent}% de coincidencia",
  "identify.viewPhotos": "Ver fotos",
  "backfill.queuedOne": "Se encoló {count} foto antigua para reprocesar.",
  "backfill.queuedOther": "Se encolaron {count} fotos antiguas para reprocesar.",
  "backfill.nothing":
    "Nada para reprocesar -- todas las fotos ya tienen datos actualizados.",
  "map.tagHint": "Hacé clic en el mapa para ubicar el nuevo lugar",
  "newEvent.title": "Nuevo evento",
  "newEvent.name": "Nombre",
  "newEvent.namePlaceholder": "ej. Montevideo 10K",
  "newEvent.date": "Fecha (opcional)",
  "common.cancel": "Cancelar",
  "common.creating": "Creando…",
  "common.create": "Crear",
  "common.close": "Cerrar",
  "common.save": "Guardar",
  "common.saving": "Guardando…",
  "common.unknown": "Desconocido",
  "photoDetail.loading": "Cargando…",
  "photoDetail.regionHint":
    "Arrastrá un recuadro sobre la foto para buscar fotos similares o vincular una cara no detectada.",
  "photoDetail.working": " Procesando…",
  "photoDetail.takenAt": "Tomada el",
  "photoDetail.gps": "Coordenadas GPS",
  "photoDetail.noGps": "Sin datos GPS",
  "photoDetail.camera": "Cámara",
  "photoDetail.photoId": "ID de foto",
  "photoDetail.idPlaceholder": "ej. 452",
  "photoDetail.status": "Estado",
  "photoDetail.textInPhoto": "Texto en la foto",
  "photoDetail.peopleInPhoto": "Personas en esta foto",
  "photoDetail.detectedFace": "Cara detectada",
  "photoDetail.notThisPerson": "No es esta persona",
  "photoDetail.revealOriginal": "Mostrar archivo original",
  "photoDetail.reprocess": "Reprocesar esta foto",
  "region.findSimilar": "Buscar similares",
  "region.linkAsPerson": "Vincular como persona",
  "results.empty": "Ninguna foto coincide con estos filtros todavía.",
  "results.unknownDate": "Fecha desconocida",
  "header.watchDir": "Colocá las fotos nuevas en: {path}",
  "filters.photoId": "ID de foto",
  "filters.event": "Evento",
  "filters.allEvents": "Todos los eventos",
  "filters.from": "Desde",
  "filters.to": "Hasta",
  "filters.location": "Ubicación",
  "filters.anywhere": "Cualquier lugar",
  "filters.radius": "Radio (km)",
  "filters.describe": "Describí qué buscar",
  "filters.describePlaceholder": "ej. remera roja",
  "filters.sceneText": "Texto visible en la foto",
  "filters.sceneTextPlaceholder": "ej. línea de llegada",
  "filters.searching": "Buscando…",
  "filters.search": "Buscar",
  "filters.refresh": "Actualizar",
  "filters.refreshTitle": "Actualizar resultados (trae las fotos recién llegadas)",
  "tagLocation.title": "Marcar ubicación",
  "tagLocation.name": "Nombre",
  "tagLocation.namePlaceholder": "ej. Línea de llegada",
  "tagLocation.latitude": "Latitud",
  "tagLocation.longitude": "Longitud",
  "tagLocation.save": "Guardar ubicación",
  "status.pending": "pendiente",
  "status.processed": "procesada",
  "status.failed": "fallida",
  "update.check": "Buscar actualizaciones",
  "update.checking": "Buscando…",
  "update.upToDate": "Ya tenés la última versión.",
  "update.available": "La versión {version} está disponible.",
  "update.install": "Instalar y reiniciar",
  "update.installing": "Instalando…",
};

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  es,
};

const statusKeys: Record<PhotoStatus, TranslationKey> = {
  pending: "status.pending",
  processed: "status.processed",
  failed: "status.failed",
};

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "es") return stored;
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

export type TranslateFn = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = dictionaries[locale];
    return {
      locale,
      setLocale,
      t: (key, vars) => interpolate(dictionary[key], vars),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return context;
}

/** English and Spanish share the regular "+s" plural for the words used here. */
export function statusLabel(t: TranslateFn, status: PhotoStatus): string {
  return t(statusKeys[status]);
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}
