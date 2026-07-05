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
  "header.changeWatchDir": "Change…",
  "header.changeWatchDirError": "Couldn't switch to that folder.",
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
  "onboarding.replayButton": "Show tutorial",
  "onboarding.next": "Next",
  "onboarding.back": "Back",
  "onboarding.skip": "Skip tour",
  "onboarding.finish": "Finish",
  "onboarding.progress": "{current} / {total}",
  "onboarding.welcome.title": "Welcome to SearchIt",
  "onboarding.welcome.body":
    "SearchIt auto-tags every photo you shoot -- faces, GPS, on-photo text, and visual similarity -- so you and your clients can find exactly the right shot. This quick tour covers the basics.",
  "onboarding.navTabs.title": "Three views",
  "onboarding.navTabs.body":
    "Photos lets you search your whole archive. People groups shots by who's in them. Map shows where every photo was taken.",
  "onboarding.searchFilters.title": "Search your archive",
  "onboarding.searchFilters.body":
    "Filter by bib number, event, date range, location and radius, a text description of the shot, or text visible in the photo (like a finish-line banner).",
  "onboarding.resultsGrid.title": "Browse results",
  "onboarding.resultsGrid.body":
    "Click any photo to open its details. Inside, you can drag a box around a region to find similar photos or to link a face SearchIt missed.",
  "onboarding.peopleGrid.title": "Everyone, automatically",
  "onboarding.peopleGrid.body":
    "SearchIt recognizes faces across your entire archive, not just one event, and groups every photo of the same person here.",
  "onboarding.identifyByPhoto.title": "Find a specific client",
  "onboarding.identifyByPhoto.body":
    "Upload a clear photo of someone's face and SearchIt will find their matching photos across every event, instantly.",
  "onboarding.mapView.title": "See it on the map",
  "onboarding.mapView.body":
    "Every photo with GPS data shows up here as a marker. Click one to jump straight to that photo.",
  "onboarding.tagLocation.title": "Tag real-world spots",
  "onboarding.tagLocation.body":
    "Mark a start line, finish line, or aid station on the map so photos near it can be found by location.",
  "onboarding.newEvent.title": "Create an event per race",
  "onboarding.newEvent.body":
    "Events keep each race's photos grouped and searchable separately. New photos land under an event based on the folder they're dropped into.",
  "onboarding.watchDir.title": "Just drop in your photos",
  "onboarding.watchDir.body":
    "Copy new photos into this folder and SearchIt processes them automatically. Already have older photos? Use the Backfill button to reprocess them too.",
  "onboarding.langToggle.title": "Switch language anytime",
  "onboarding.langToggle.body":
    "SearchIt works in English and Spanish. You can replay this tour whenever you like from the \"?\" button up here.",
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
  "header.changeWatchDir": "Cambiar…",
  "header.changeWatchDirError": "No se pudo cambiar a esa carpeta.",
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
  "onboarding.replayButton": "Mostrar tutorial",
  "onboarding.next": "Siguiente",
  "onboarding.back": "Atrás",
  "onboarding.skip": "Saltar tutorial",
  "onboarding.finish": "Finalizar",
  "onboarding.progress": "{current} / {total}",
  "onboarding.welcome.title": "Bienvenido a SearchIt",
  "onboarding.welcome.body":
    "SearchIt etiqueta automáticamente cada foto que sacás -- caras, GPS, texto en la imagen y similitud visual -- para que vos y tus clientes encuentren justo la foto que buscan. Este recorrido rápido cubre lo básico.",
  "onboarding.navTabs.title": "Tres vistas",
  "onboarding.navTabs.body":
    "Fotos te deja buscar en todo tu archivo. Personas agrupa las fotos según quién aparece en ellas. Mapa muestra dónde se tomó cada foto.",
  "onboarding.searchFilters.title": "Buscá en tu archivo",
  "onboarding.searchFilters.body":
    "Filtrá por número de dorsal, evento, rango de fechas, ubicación y radio, una descripción de la escena, o texto visible en la foto (como un cartel de la línea de llegada).",
  "onboarding.resultsGrid.title": "Explorá los resultados",
  "onboarding.resultsGrid.body":
    "Hacé clic en cualquier foto para ver sus detalles. Ahí podés arrastrar un recuadro para buscar fotos similares o vincular una cara que SearchIt no detectó.",
  "onboarding.peopleGrid.title": "Todos, automáticamente",
  "onboarding.peopleGrid.body":
    "SearchIt reconoce caras en todo tu archivo, no solo en un evento, y agrupa acá todas las fotos de la misma persona.",
  "onboarding.identifyByPhoto.title": "Encontrá a un cliente puntual",
  "onboarding.identifyByPhoto.body":
    "Subí una foto clara de la cara de alguien y SearchIt va a encontrar sus fotos en todos los eventos, al instante.",
  "onboarding.mapView.title": "Vela en el mapa",
  "onboarding.mapView.body":
    "Cada foto con datos GPS aparece acá como un marcador. Hacé clic en uno para ir directo a esa foto.",
  "onboarding.tagLocation.title": "Marcá lugares reales",
  "onboarding.tagLocation.body":
    "Marcá una largada, una llegada o un puesto de hidratación en el mapa para poder encontrar fotos cercanas por ubicación.",
  "onboarding.newEvent.title": "Creá un evento por carrera",
  "onboarding.newEvent.body":
    "Los eventos mantienen las fotos de cada carrera agrupadas y buscables por separado. Las fotos nuevas se asignan a un evento según la carpeta donde las soltás.",
  "onboarding.watchDir.title": "Simplemente soltá tus fotos",
  "onboarding.watchDir.body":
    "Copiá las fotos nuevas en esta carpeta y SearchIt las procesa automáticamente. ¿Ya tenés fotos viejas? Usá el botón Reprocesar para procesarlas también.",
  "onboarding.langToggle.title": "Cambiá de idioma cuando quieras",
  "onboarding.langToggle.body":
    "SearchIt funciona en inglés y en español. Podés volver a ver este tutorial cuando quieras desde el botón \"?\" de acá arriba.",
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
