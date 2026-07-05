import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Aperture,
  ArrowLeft,
  CalendarPlus,
  DownloadCloud,
  FolderOpen,
  Globe,
  Images,
  Map as MapIcon,
  MapPinPlus,
  RefreshCw,
  ScanFace,
  Server,
  Terminal,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type {
  EventSummary,
  IdentitySummary,
  LocationSummary,
  PhotoSummary,
  SearchFilters,
} from "@searchit/shared";
import "./App.css";
import { DeveloperPanel } from "./components/DeveloperPanel";
import { IdentifyByPhotoModal } from "./components/IdentifyByPhotoModal";
import { MapView } from "./components/MapView";
import { NewEventModal } from "./components/NewEventModal";
import { PeopleGrid } from "./components/PeopleGrid";
import { PhotoDetailPanel } from "./components/PhotoDetailPanel";
import { ResultsGrid } from "./components/ResultsGrid";
import { SearchFiltersPanel } from "./components/SearchFiltersPanel";
import { TagLocationModal } from "./components/TagLocationModal";
import {
  backfillPhotos,
  createEvent,
  createLocation,
  getConfig,
  getEvents,
  getIdentities,
  getIdentityPhotos,
  getLocations,
  renameIdentity,
  searchPhotos,
} from "./lib/api";
import { useTranslation } from "./lib/i18n";
import { getApiBaseUrl, setApiBaseUrl } from "./lib/settings";
import {
  getBackendUrl,
  pickWatchFolder,
  setWatchDir as setServerWatchDir,
} from "./lib/tauri";
import { iconButton, pill, primaryButton } from "./lib/theme";
import {
  checkForUpdate,
  installPendingUpdate,
  type UpdateInfo,
} from "./lib/updater";

const POLL_INTERVAL_MS = 5000;

interface SimilarityQuery {
  sourcePhotoId: string;
  results: PhotoSummary[];
}

interface PendingLocation {
  lat: number;
  lon: number;
}

type Tab = "photos" | "people" | "map" | "developer";

const TABS: { key: Tab; labelKey: "nav.photos" | "nav.people" | "nav.map" | "nav.developer"; icon: typeof Images }[] = [
  { key: "photos", labelKey: "nav.photos", icon: Images },
  { key: "people", labelKey: "nav.people", icon: Users },
  { key: "map", labelKey: "nav.map", icon: MapIcon },
  { key: "developer", labelKey: "nav.developer", icon: Terminal },
];

function App() {
  const { t, locale, setLocale } = useTranslation();
  const [tab, setTab] = useState<Tab>("photos");
  const [apiBaseUrlInput, setApiBaseUrlInput] = useState(getApiBaseUrl());
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [photos, setPhotos] = useState<PhotoSummary[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewEventModal, setShowNewEventModal] = useState(false);
  const [showIdentifyModal, setShowIdentifyModal] = useState(false);
  const [isTaggingLocation, setIsTaggingLocation] = useState(false);
  const [watchDir, setWatchDir] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] =
    useState<PendingLocation | null>(null);

  const [identities, setIdentities] = useState<IdentitySummary[]>([]);
  const [selectedIdentity, setSelectedIdentity] =
    useState<IdentitySummary | null>(null);
  const [identityPhotos, setIdentityPhotos] = useState<PhotoSummary[]>([]);

  const [similarityQuery, setSimilarityQuery] =
    useState<SimilarityQuery | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(
    null,
  );
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [isBackendUrlResolved, setIsBackendUrlResolved] = useState(false);

  function refreshEvents(options?: { silent?: boolean }) {
    getEvents()
      .then(setEvents)
      .catch(() => {
        if (!options?.silent) setEvents([]);
      });
  }

  function refreshLocations(options?: { silent?: boolean }) {
    getLocations()
      .then(setLocations)
      .catch(() => {
        if (!options?.silent) setLocations([]);
      });
  }

  // The bundled server sidecar binds to a free port chosen at launch, so the
  // hardcoded default in settings.ts is only a guess -- ask Rust for the real
  // URL before making any API calls. Rejects when not running inside the
  // Tauri shell (e.g. `bun run dev` in a plain browser), which just keeps
  // whatever's already configured.
  useEffect(() => {
    let cancelled = false;
    getBackendUrl()
      .then((url) => {
        if (cancelled) return;
        setApiBaseUrl(url);
        setApiBaseUrlInput(url);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsBackendUrlResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Show every photo by default -- otherwise the grid stays empty until the
  // user submits the filter form at least once, even though no filters
  // means "match everything" on the server.
  useEffect(() => {
    if (!isBackendUrlResolved) return;
    refreshEvents();
    refreshLocations();
    void runSearch();
    getConfig()
      .then((config) => setWatchDir(config.watchDir))
      .catch(() => setWatchDir(null));
  }, [isBackendUrlResolved]);

  // The server ingests new photos in the background (folder watcher +
  // inference pipeline), and other clients may create events/locations at
  // any time, so poll instead of relying on a manual refresh. A silent poll
  // leaves existing data on screen if a request happens to fail.
  useEffect(() => {
    const id = setInterval(() => {
      if (!similarityQuery) void runSearch({ silent: true });
      refreshEvents({ silent: true });
      refreshLocations({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [filters, similarityQuery]);

  // Photos keep arriving in the background while the app is open, so refresh
  // the roster each time the tab is opened rather than only once on mount,
  // then keep polling while the tab stays open.
  useEffect(() => {
    if (tab !== "people") return;
    refreshIdentities();
    const id = setInterval(() => refreshIdentities({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tab]);

  function refreshIdentities(options?: { silent?: boolean }) {
    getIdentities()
      .then(setIdentities)
      .catch(() => {
        if (!options?.silent) setIdentities([]);
      });
  }

  async function runSearch(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const results = await searchPhotos(filters);
      setPhotos(results);
      if (!options?.silent) setError(null);
    } catch (err) {
      if (!options?.silent) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!options?.silent) setIsLoading(false);
    }
  }

  async function openIdentity(identity: IdentitySummary) {
    setSelectedIdentity(identity);
    setError(null);
    try {
      setIdentityPhotos(await getIdentityPhotos(identity.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRenameIdentity(
    id: string,
    displayName: string | null,
  ) {
    try {
      await renameIdentity(id, displayName);
      refreshIdentities();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleFindSimilar(sourcePhotoId: string, results: PhotoSummary[]) {
    setSimilarityQuery({ sourcePhotoId, results });
    setTab("photos");
    setSelectedPhotoId(null);
  }

  async function handleCreateEvent(body: Parameters<typeof createEvent>[0]) {
    await createEvent(body);
    refreshEvents();
  }

  async function handleCreateLocation(
    body: Parameters<typeof createLocation>[0],
  ) {
    await createLocation(body);
    refreshLocations();
  }

  function handleMapClick(lat: number, lon: number) {
    if (!isTaggingLocation) return;
    setPendingLocation({ lat, lon });
    setIsTaggingLocation(false);
  }

  async function handleBackfill() {
    setError(null);
    setStatusMessage(null);
    try {
      const { queued } = await backfillPhotos();
      setStatusMessage(
        queued > 0
          ? t(queued === 1 ? "backfill.queuedOne" : "backfill.queuedOther", {
              count: queued,
            })
          : t("backfill.nothing"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCheckForUpdate() {
    setIsCheckingUpdate(true);
    setError(null);
    setStatusMessage(null);
    try {
      const update = await checkForUpdate();
      setAvailableUpdate(update);
      if (!update) setStatusMessage(t("update.upToDate"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    setIsInstallingUpdate(true);
    setError(null);
    try {
      await installPendingUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsInstallingUpdate(false);
    }
  }

  async function handleChangeWatchDir() {
    const picked = await pickWatchFolder();
    if (!picked) return;
    setError(null);
    try {
      await setServerWatchDir(picked);
      setWatchDir(picked);
    } catch {
      setError(t("header.changeWatchDirError"));
    }
  }

  return (
    <main className="flex h-screen flex-col bg-navy-950 font-sans text-mist-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-800 px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="flex items-center gap-1.5 font-serif text-lg font-semibold text-mist-100">
            <Aperture className="h-5 w-5 text-blue-500" />
            SearchIt
          </h1>
          <nav className="relative flex items-center gap-1 rounded-full border border-navy-800 bg-navy-900/60 p-1 text-sm">
            {TABS.map(({ key, labelKey, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTab(key);
                    if (key === "people") setSelectedIdentity(null);
                  }}
                  className={`relative z-10 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    active ? "text-navy-950" : "text-mist-300 hover:text-mist-100"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="tab-indicator"
                      className="absolute inset-0 -z-10 rounded-full bg-blue-500"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon className="h-3.5 w-3.5" />
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "map" && (
            <button
              type="button"
              onClick={() => setIsTaggingLocation((current) => !current)}
              className={
                isTaggingLocation
                  ? "inline-flex items-center gap-1.5 rounded-full bg-blue-500 px-3 py-1.5 text-xs font-semibold text-navy-950"
                  : pill
              }
            >
              <MapPinPlus className="h-3.5 w-3.5" />
              {isTaggingLocation
                ? t("header.tagLocationActive")
                : t("header.tagLocation")}
            </button>
          )}
          {tab === "people" && (
            <button
              type="button"
              onClick={() => setShowIdentifyModal(true)}
              className={pill}
            >
              <ScanFace className="h-3.5 w-3.5" />
              {t("people.identifyByPhoto")}
            </button>
          )}
          <button type="button" onClick={() => setShowNewEventModal(true)} className={pill}>
            <CalendarPlus className="h-3.5 w-3.5" />
            {t("header.newEvent")}
          </button>
          <button type="button" onClick={() => void handleBackfill()} className={pill}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("header.backfill")}
          </button>
          <button
            type="button"
            disabled={isCheckingUpdate}
            onClick={() => void handleCheckForUpdate()}
            className={pill}
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            {isCheckingUpdate ? t("update.checking") : t("update.check")}
          </button>
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "es" : "en")}
            title="Language / Idioma"
            className={pill}
          >
            <Globe className="h-3.5 w-3.5" />
            {locale === "en" ? "ES" : "EN"}
          </button>
          <label className="flex items-center gap-1.5 rounded-full border border-navy-700 bg-navy-800/80 px-3 py-1.5 text-xs text-mist-300">
            <Server className="h-3.5 w-3.5 shrink-0" />
            <input
              type="text"
              value={apiBaseUrlInput}
              onChange={(event) => setApiBaseUrlInput(event.target.value)}
              onBlur={() => setApiBaseUrl(apiBaseUrlInput)}
              className="w-40 bg-transparent text-mist-100 outline-none"
            />
          </label>
        </div>
      </header>

      {watchDir && (
        <p className="flex items-center gap-2 truncate border-b border-navy-900 px-4 py-1.5 text-xs text-mist-500">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {t("header.watchDir", { path: watchDir })}
          </span>
          <button
            type="button"
            onClick={() => void handleChangeWatchDir()}
            className="shrink-0 rounded-full border border-navy-700 px-2 py-0.5 hover:bg-navy-800"
          >
            {t("header.changeWatchDir")}
          </button>
        </p>
      )}

      {error && (
        <p className="flex items-center gap-2 px-4 py-2 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      {statusMessage && (
        <p className="px-4 py-2 text-sm text-mist-500">{statusMessage}</p>
      )}
      {availableUpdate && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-mist-300">
          <span>
            {t("update.available", { version: availableUpdate.version })}
          </span>
          <button
            type="button"
            disabled={isInstallingUpdate}
            onClick={() => void handleInstallUpdate()}
            className={primaryButton}
          >
            {isInstallingUpdate ? t("update.installing") : t("update.install")}
          </button>
        </div>
      )}

      {tab === "photos" &&
        (similarityQuery ? (
          <>
            <div className="flex items-center gap-2 border-b border-navy-800 px-4 py-2 text-sm">
              <span className="text-mist-500">{t("similarity.banner")}</span>
              <button
                type="button"
                onClick={() => setSimilarityQuery(null)}
                className="text-blue-400 underline hover:text-blue-300"
              >
                {t("similarity.clear")}
              </button>
            </div>
            <ResultsGrid
              photos={similarityQuery.results}
              onSelect={(photo) => setSelectedPhotoId(photo.id)}
            />
          </>
        ) : (
          <>
            <SearchFiltersPanel
              events={events}
              locations={locations}
              filters={filters}
              onChange={setFilters}
              onSubmit={() => void runSearch()}
              isLoading={isLoading}
            />
            <ResultsGrid
              photos={photos}
              onSelect={(photo) => setSelectedPhotoId(photo.id)}
            />
          </>
        ))}

      {tab === "people" &&
        (selectedIdentity ? (
          <>
            <div className="flex items-center gap-2 border-b border-navy-800 px-4 py-2">
              <button
                type="button"
                onClick={() => setSelectedIdentity(null)}
                className={iconButton}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="font-serif text-sm font-medium text-mist-100">
                {selectedIdentity.displayName ?? t("people.unnamedPerson")}
              </span>
            </div>
            <ResultsGrid
              photos={identityPhotos}
              onSelect={(photo) => setSelectedPhotoId(photo.id)}
            />
          </>
        ) : (
          <PeopleGrid
            identities={identities}
            onSelect={(identity) => void openIdentity(identity)}
            onRename={(id, displayName) =>
              void handleRenameIdentity(id, displayName)
            }
          />
        ))}

      {tab === "map" && (
        <MapView
          photos={photos}
          locations={locations}
          onSelectPhoto={(photo) => setSelectedPhotoId(photo.id)}
          isTagging={isTaggingLocation}
          onMapClick={handleMapClick}
        />
      )}

      {tab === "developer" && <DeveloperPanel />}

      <AnimatePresence>
        {showNewEventModal && (
          <NewEventModal
            onClose={() => setShowNewEventModal(false)}
            onCreate={handleCreateEvent}
          />
        )}

        {showIdentifyModal && (
          <IdentifyByPhotoModal
            onClose={() => setShowIdentifyModal(false)}
            onOpenIdentity={(identity) => {
              setShowIdentifyModal(false);
              void openIdentity(identity);
            }}
            onRename={(id, displayName) =>
              void handleRenameIdentity(id, displayName)
            }
          />
        )}

        {pendingLocation && (
          <TagLocationModal
            initialLat={pendingLocation.lat}
            initialLon={pendingLocation.lon}
            onClose={() => setPendingLocation(null)}
            onCreate={handleCreateLocation}
          />
        )}

        {selectedPhotoId && (
          <PhotoDetailPanel
            photoId={selectedPhotoId}
            locations={locations}
            onClose={() => setSelectedPhotoId(null)}
            onFindSimilar={handleFindSimilar}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

export default App;
