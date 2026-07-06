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
  "nav.developer": "Developer",
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
  "importPhotos.title": "Import photos",
  "importPhotos.body":
    'Event "{eventName}" created. Drop photos into this folder and they\'ll be indexed automatically:',
  "importPhotos.openFolder": "Open folder",
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
  "header.settings": "Settings",
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.server": "Server address",
  "settings.watchDir": "Watch folder",
  "settings.updates": "Updates",
  "titlebar.minimize": "Minimize",
  "titlebar.maximize": "Maximize",
  "titlebar.restore": "Restore",
  "titlebar.close": "Close",
  "filters.event": "Event",
  "filters.allEvents": "All events",
  "filters.from": "From",
  "filters.to": "To",
  "filters.location": "Location",
  "filters.anywhere": "Anywhere",
  "filters.radius": "Radius (km)",
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
  "developer.currentIndexing": "Current indexing",
  "developer.stats": "Stats",
  "developer.currentlyIndexed": "Currently indexed",
  "developer.queue": "Queue",
  "developer.processing": "Processing",
  "developer.indexedLastTenMinutes": "Indexed last 10 minutes",
  "developer.workers": "Workers",
  "developer.status": "Status",
  "developer.inferenceStatus": "Inference Status",
  "developer.inferencePort": "Inference Port",
  "developer.serverStatus": "Server Status",
  "developer.serverPort": "Server Port",
  "developer.ready": "Ready",
  "developer.down": "Down",
  "developer.nominal": "Nominal",
  "developer.failedPhotos": "Failed Photos",
  "developer.noFailedPhotos": "No failed photos. Every photo indexed cleanly.",
  "developer.retry": "Retry",
  "developer.retrying": "Retrying…",
  "developer.retryAll": "Retry all",
  "developer.retryingAll": "Retrying all…",
  "developer.retryAllResult": "Retried {succeeded} of {attempted} failed photos.",
  "developer.clearFailed": "Clear failed",
  "developer.clearingFailed": "Clearing…",
  "developer.clearFailedConfirm": "Delete all {count} failed photo entries? This can't be undone.",
  "developer.clearFailedResult": "Cleared {deleted} failed photo entries.",
  "developer.diagnostics": "Diagnostics",
  "developer.serverProcess": "Server process",
  "developer.inferenceProcess": "Inference process",
  "developer.processRunning": "Running",
  "developer.processCrashed": "Crashed (exit code {code})",
  "developer.processStopped": "Stopped",
  "developer.lastError": "Last error",
  "developer.viewLogs": "View logs",
  "developer.hideLogs": "Hide logs",
  "developer.openLogFile": "Open log file",
  "developer.noLogs": "No logs yet.",
  "developer.inferenceDownToast":
    "Some photos failed because the inference server isn't responding. They'll retry automatically once it's back up.",
  "developer.inferenceRecoveredToastOne":
    "Inference server is back up. Retrying {count} photo that failed while it was down.",
  "developer.inferenceRecoveredToastOther":
    "Inference server is back up. Retrying {count} photos that failed while it was down.",
  "developer.restartServer": "Restart server",
  "developer.restartInference": "Restart inference",
  "developer.restarting": "Restarting…",
  "developer.serverRestarted": "Server restarted.",
  "developer.inferenceRestarted": "Inference restarted.",
  "developer.restartFailed": "Restart failed: {error}",
} as const;

export type TranslationKey = keyof typeof en;

const es: Record<TranslationKey, string> = {
  "nav.photos": "Fotos",
  "nav.people": "Personas",
  "nav.map": "Mapa",
  "nav.developer": "Desarrollador",
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
  "importPhotos.title": "Importar fotos",
  "importPhotos.body":
    'Se creó el evento "{eventName}". Colocá las fotos en esta carpeta y se indexarán automáticamente:',
  "importPhotos.openFolder": "Abrir carpeta",
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
  "header.settings": "Configuración",
  "settings.title": "Configuración",
  "settings.language": "Idioma",
  "settings.server": "Dirección del servidor",
  "settings.watchDir": "Carpeta vigilada",
  "settings.updates": "Actualizaciones",
  "titlebar.minimize": "Minimizar",
  "titlebar.maximize": "Maximizar",
  "titlebar.restore": "Restaurar",
  "titlebar.close": "Cerrar",
  "filters.event": "Evento",
  "filters.allEvents": "Todos los eventos",
  "filters.from": "Desde",
  "filters.to": "Hasta",
  "filters.location": "Ubicación",
  "filters.anywhere": "Cualquier lugar",
  "filters.radius": "Radio (km)",
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
  "developer.currentIndexing": "Indexación actual",
  "developer.stats": "Estadísticas",
  "developer.currentlyIndexed": "Indexadas actualmente",
  "developer.queue": "Cola",
  "developer.processing": "Procesando",
  "developer.indexedLastTenMinutes": "Indexadas en los últimos 10 minutos",
  "developer.workers": "Procesos",
  "developer.status": "Estado",
  "developer.inferenceStatus": "Estado de inferencia",
  "developer.inferencePort": "Puerto de inferencia",
  "developer.serverStatus": "Estado del servidor",
  "developer.serverPort": "Puerto del servidor",
  "developer.ready": "Listo",
  "developer.down": "Caído",
  "developer.nominal": "Nominal",
  "developer.failedPhotos": "Fotos fallidas",
  "developer.noFailedPhotos": "No hay fotos fallidas. Todo se indexó bien.",
  "developer.retry": "Reintentar",
  "developer.retrying": "Reintentando…",
  "developer.retryAll": "Reintentar todas",
  "developer.retryingAll": "Reintentando todas…",
  "developer.retryAllResult": "Se reintentaron {succeeded} de {attempted} fotos fallidas.",
  "developer.clearFailed": "Borrar fallidas",
  "developer.clearingFailed": "Borrando…",
  "developer.clearFailedConfirm": "¿Eliminar las {count} fotos fallidas? Esta acción no se puede deshacer.",
  "developer.clearFailedResult": "Se eliminaron {deleted} fotos fallidas.",
  "developer.diagnostics": "Diagnóstico",
  "developer.serverProcess": "Proceso del servidor",
  "developer.inferenceProcess": "Proceso de inferencia",
  "developer.processRunning": "En ejecución",
  "developer.processCrashed": "Se cerró (código de salida {code})",
  "developer.processStopped": "Detenido",
  "developer.lastError": "Último error",
  "developer.viewLogs": "Ver registros",
  "developer.hideLogs": "Ocultar registros",
  "developer.openLogFile": "Abrir archivo de registro",
  "developer.noLogs": "Todavía no hay registros.",
  "developer.inferenceDownToast":
    "Algunas fotos fallaron porque el servidor de inferencia no responde. Se reintentarán automáticamente cuando vuelva a estar disponible.",
  "developer.inferenceRecoveredToastOne":
    "El servidor de inferencia volvió a estar disponible. Reintentando {count} foto que falló mientras estuvo caído.",
  "developer.inferenceRecoveredToastOther":
    "El servidor de inferencia volvió a estar disponible. Reintentando {count} fotos que fallaron mientras estuvo caído.",
  "developer.restartServer": "Reiniciar servidor",
  "developer.restartInference": "Reiniciar inferencia",
  "developer.restarting": "Reiniciando…",
  "developer.serverRestarted": "Servidor reiniciado.",
  "developer.inferenceRestarted": "Inferencia reiniciada.",
  "developer.restartFailed": "No se pudo reiniciar: {error}",
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
