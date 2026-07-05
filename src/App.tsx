import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  FolderOpen,
  House,
  Images,
  Map as MapIcon,
  MapPinPlus,
  RefreshCw,
  ScanFace,
  Settings as SettingsIcon,
  Terminal,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type {
  DeveloperStatsResponseBody,
  EventSummary,
  IdentitySummary,
  LocationSummary,
  PhotoSummary,
  SearchFilters,
} from "@searchit/shared";
import "./App.css";
import { DeveloperPanel } from "./components/DeveloperPanel";
import { HomeView } from "./components/HomeView";
import { IdentifyByPhotoModal } from "./components/IdentifyByPhotoModal";
import { ImportPhotosModal } from "./components/ImportPhotosModal";
import { MapView } from "./components/MapView";
import { NewEventModal } from "./components/NewEventModal";
import { PeopleGrid } from "./components/PeopleGrid";
import { PhotoDetailPanel } from "./components/PhotoDetailPanel";
import { ResultsGrid } from "./components/ResultsGrid";
import { SearchFiltersPanel } from "./components/SearchFiltersPanel";
import { SettingsModal } from "./components/SettingsModal";
import { TagLocationModal } from "./components/TagLocationModal";
import { TitleBar } from "./components/TitleBar";
import {
  backfillPhotos,
  createEvent,
  createLocation,
  getConfig,
  getDeveloperStats,
  getEvents,
  getIdentities,
  getIdentityPhotos,
  getLocations,
  renameIdentity,
  retryAllFailedPhotos,
  searchPhotos,
  updateEvent,
} from "./lib/api";
import { useTranslation } from "./lib/i18n";
import { setApiBaseUrl } from "./lib/settings";
import { getBackendUrl } from "./lib/tauri";
import { iconButton, pill } from "./lib/theme";
import { useToast } from "./lib/toast";

const POLL_INTERVAL_MS = 5000;

interface SimilarityQuery {
  sourcePhotoId: string;
  results: PhotoSummary[];
}

interface ImportPrompt {
  eventName: string;
  folderPath: string;
}

interface PendingLocation {
  lat: number;
  lon: number;
}

type Tab = "home" | "photos" | "people" | "map" | "developer";

const TABS: { key: Tab; labelKey: "nav.home" | "nav.photos" | "nav.people" | "nav.map" | "nav.developer"; icon: typeof Images }[] = [
  { key: "home", labelKey: "nav.home", icon: House },
  { key: "photos", labelKey: "nav.photos", icon: Images },
  { key: "people", labelKey: "nav.people", icon: Users },
  { key: "map", labelKey: "nav.map", icon: MapIcon },
  { key: "developer", labelKey: "nav.developer", icon: Terminal },
];

function App() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("home");
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [photos, setPhotos] = useState<PhotoSummary[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [showNewEventModal, setShowNewEventModal] = useState(false);
  const [importPrompt, setImportPrompt] = useState<ImportPrompt | null>(null);
  const [showIdentifyModal, setShowIdentifyModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isTaggingLocation, setIsTaggingLocation] = useState(false);
  const [watchDir, setWatchDir] = useState<string | null>(null);
  const [faceRecognitionEnabled, setFaceRecognitionEnabled] = useState(true);
  const [visualSearchEnabled, setVisualSearchEnabled] = useState(true);
  const [pendingLocation, setPendingLocation] =
    useState<PendingLocation | null>(null);

  const [identities, setIdentities] = useState<IdentitySummary[]>([]);
  const [selectedIdentity, setSelectedIdentity] =
    useState<IdentitySummary | null>(null);
  const [identityPhotos, setIdentityPhotos] = useState<PhotoSummary[]>([]);

  const [similarityQuery, setSimilarityQuery] =
    useState<SimilarityQuery | null>(null);

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
      .then((config) => {
        setWatchDir(config.watchDir);
        setFaceRecognitionEnabled(config.faceRecognitionEnabled);
        setVisualSearchEnabled(config.visualSearchEnabled);
      })
      .catch(() => setWatchDir(null));
  }, [isBackendUrlResolved]);

  // Face recognition can be turned off while the People tab is open (e.g.
  // from Settings) -- bounce back to Home rather than leaving the user on a
  // tab whose nav button just disappeared.
  useEffect(() => {
    if (tab === "people" && !faceRecognitionEnabled) setTab("home");
  }, [tab, faceRecognitionEnabled]);

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

  // Photos fail with a generic error when the inference sidecar is
  // unreachable, which looks like a bug to a photographer who never opens the
  // Developer tab. Poll for that specific condition regardless of which tab
  // is open, explain it in plain language, and retry those photos as soon as
  // inference responds again instead of leaving them stuck until someone
  // notices and clicks "Retry all" manually.
  const inferenceWasDownRef = useRef(false);

  useEffect(() => {
    if (!isBackendUrlResolved) return;

    async function checkInferenceRecovery() {
      let stats: DeveloperStatsResponseBody;
      try {
        stats = await getDeveloperStats();
      } catch {
        return;
      }

      if (stats.inferenceStatus === "down" && stats.failedCount > 0) {
        if (!inferenceWasDownRef.current) {
          inferenceWasDownRef.current = true;
          showToast(t("developer.inferenceDownToast"), "error");
        }
        return;
      }

      if (stats.inferenceStatus === "ready" && inferenceWasDownRef.current) {
        inferenceWasDownRef.current = false;
        try {
          const result = await retryAllFailedPhotos();
          if (result.attempted > 0) {
            showToast(
              t(
                result.attempted === 1
                  ? "developer.inferenceRecoveredToastOne"
                  : "developer.inferenceRecoveredToastOther",
                { count: result.attempted },
              ),
              "success",
            );
          }
        } catch {
          // The Developer tab's manual "Retry all" button is still available.
        }
      }
    }

    void checkInferenceRecovery();
    const id = setInterval(() => void checkInferenceRecovery(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isBackendUrlResolved]);

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

  async function runSearch(options?: { silent?: boolean; filters?: SearchFilters }) {
    if (!options?.silent) {
      setIsLoading(true);
    }
    try {
      const results = await searchPhotos(options?.filters ?? filters);
      setPhotos(results);
    } catch (err) {
      if (!options?.silent) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
    } finally {
      if (!options?.silent) setIsLoading(false);
    }
  }

  async function openIdentity(identity: IdentitySummary) {
    setSelectedIdentity(identity);
    try {
      setIdentityPhotos(await getIdentityPhotos(identity.id));
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
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
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function handleFindSimilar(sourcePhotoId: string, results: PhotoSummary[]) {
    setSimilarityQuery({ sourcePhotoId, results });
    setTab("photos");
    setSelectedPhotoId(null);
  }

  async function handleCreateEvent(body: Parameters<typeof createEvent>[0]) {
    const created = await createEvent(body);
    refreshEvents();

    // Jump straight to the new (empty) event instead of leaving the user on
    // whatever filter they had before -- there's nothing to see there yet.
    const nextFilters = { ...filters, eventId: created.id };
    setFilters(nextFilters);
    setSimilarityQuery(null);
    setTab("photos");
    void runSearch({ filters: nextFilters });

    setImportPrompt({ eventName: created.name, folderPath: created.folderPath });
  }

  async function handleToggleEventSportsMode(
    eventId: string,
    sportsMode: boolean,
  ) {
    await updateEvent(eventId, { sportsMode });
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
    try {
      const { queued } = await backfillPhotos();
      showToast(
        queued > 0
          ? t(queued === 1 ? "backfill.queuedOne" : "backfill.queuedOther", {
              count: queued,
            })
          : t("backfill.nothing"),
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  function handleHomeSearch(query: string) {
    setFilters((current) => ({ ...current, q: query }));
    setSimilarityQuery(null);
    setTab("photos");
  }

  function handleHomeAllPhotos() {
    setFilters({});
    setSimilarityQuery(null);
    setTab("photos");
  }

  function handleHomeSelectEvent(eventId: string) {
    setFilters({ eventId });
    setSimilarityQuery(null);
    setTab("photos");
  }

  return (
    <main className="flex h-screen flex-col bg-navy-950 font-sans text-mist-100">
      <TitleBar />
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-4">
          <nav className="relative flex items-center gap-1 rounded-full border border-navy-800 bg-navy-900/60 p-1 text-sm">
            {TABS.filter((tabDef) => tabDef.key !== "people" || faceRecognitionEnabled).map(
              ({ key, labelKey, icon: Icon }) => {
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
              },
            )}
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
          {tab === "people" && faceRecognitionEnabled && (
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
            onClick={() => setShowSettingsModal(true)}
            className={pill}
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            {t("header.settings")}
          </button>
        </div>
      </header>

      {watchDir && (
        <p className="flex items-center gap-2 truncate border-b border-navy-900 px-4 py-1.5 text-xs text-mist-500">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {t("header.watchDir", { path: watchDir })}
          </span>
        </p>
      )}

      {tab === "home" && (
        <HomeView
          events={events}
          onSearch={handleHomeSearch}
          onAllPhotos={handleHomeAllPhotos}
          onSelectEvent={handleHomeSelectEvent}
        />
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
              onToggleEventSportsMode={(eventId, sportsMode) =>
                void handleToggleEventSportsMode(eventId, sportsMode)
              }
              isLoading={isLoading}
              visualSearchEnabled={visualSearchEnabled}
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

      {tab === "developer" && (
        <DeveloperPanel onSelectPhoto={(photoId) => setSelectedPhotoId(photoId)} />
      )}

      <AnimatePresence>
        {showSettingsModal && (
          <SettingsModal
            onClose={() => setShowSettingsModal(false)}
            onSettingsChanged={(settings) => {
              setWatchDir(settings.currentWatchDir);
              setFaceRecognitionEnabled(settings.faceRecognitionEnabled);
              setVisualSearchEnabled(settings.visualSearchEnabled);
            }}
          />
        )}

        {showNewEventModal && (
          <NewEventModal
            onClose={() => setShowNewEventModal(false)}
            onCreate={handleCreateEvent}
          />
        )}

        {importPrompt && (
          <ImportPhotosModal
            eventName={importPrompt.eventName}
            folderPath={importPrompt.folderPath}
            onClose={() => setImportPrompt(null)}
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
            visualSearchEnabled={visualSearchEnabled}
            faceRecognitionEnabled={faceRecognitionEnabled}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

export default App;
