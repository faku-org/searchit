import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type {
  EventSummary,
  IdentitySummary,
  LocationSummary,
  PhotoSummary,
  SearchFilters,
} from "@searchit/shared";
import "./App.css";
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

type Tab = "photos" | "people" | "map";

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

  // Show every photo by default -- otherwise the grid stays empty until the
  // user submits the filter form at least once, even though no filters
  // means "match everything" on the server.
  useEffect(() => {
    refreshEvents();
    refreshLocations();
    void runSearch();
    getConfig()
      .then((config) => setWatchDir(config.watchDir))
      .catch(() => setWatchDir(null));
  }, []);

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

  return (
    <main className="flex h-screen flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold">SearchIt</h1>
          <nav className="flex gap-1 text-sm">
            <TabButton
              active={tab === "photos"}
              onClick={() => setTab("photos")}
            >
              {t("nav.photos")}
            </TabButton>
            <TabButton
              active={tab === "people"}
              onClick={() => {
                setTab("people");
                setSelectedIdentity(null);
              }}
            >
              {t("nav.people")}
            </TabButton>
            <TabButton active={tab === "map"} onClick={() => setTab("map")}>
              {t("nav.map")}
            </TabButton>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          {tab === "map" && (
            <button
              type="button"
              onClick={() => setIsTaggingLocation((current) => !current)}
              className={`rounded border px-2 py-1 ${
                isTaggingLocation
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              }`}
            >
              {isTaggingLocation
                ? t("header.tagLocationActive")
                : t("header.tagLocation")}
            </button>
          )}
          {tab === "people" && (
            <button
              type="button"
              onClick={() => setShowIdentifyModal(true)}
              className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {t("people.identifyByPhoto")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowNewEventModal(true)}
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t("header.newEvent")}
          </button>
          <button
            type="button"
            onClick={() => void handleBackfill()}
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {t("header.backfill")}
          </button>
          <button
            type="button"
            disabled={isCheckingUpdate}
            onClick={() => void handleCheckForUpdate()}
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {isCheckingUpdate ? t("update.checking") : t("update.check")}
          </button>
          <button
            type="button"
            onClick={() => setLocale(locale === "en" ? "es" : "en")}
            title="Language / Idioma"
            className="rounded border border-neutral-300 px-2 py-1 font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {locale === "en" ? "ES" : "EN"}
          </button>
          <span>{t("header.server")}</span>
          <input
            type="text"
            value={apiBaseUrlInput}
            onChange={(event) => setApiBaseUrlInput(event.target.value)}
            onBlur={() => setApiBaseUrl(apiBaseUrlInput)}
            className="w-56 rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      </header>

      {watchDir && (
        <p className="truncate px-4 py-1 text-xs text-neutral-400 dark:text-neutral-600">
          {t("header.watchDir", { path: watchDir })}
        </p>
      )}

      {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
      {statusMessage && (
        <p className="px-4 py-2 text-sm text-neutral-500">{statusMessage}</p>
      )}
      {availableUpdate && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-neutral-500">
          <span>
            {t("update.available", { version: availableUpdate.version })}
          </span>
          <button
            type="button"
            disabled={isInstallingUpdate}
            onClick={() => void handleInstallUpdate()}
            className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {isInstallingUpdate ? t("update.installing") : t("update.install")}
          </button>
        </div>
      )}

      {tab === "photos" &&
        (similarityQuery ? (
          <>
            <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 text-sm dark:border-neutral-800">
              <span className="text-neutral-500">
                {t("similarity.banner")}
              </span>
              <button
                type="button"
                onClick={() => setSimilarityQuery(null)}
                className="text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
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
            <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setSelectedIdentity(null)}
                className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                {t("people.back")}
              </button>
              <span className="text-sm font-medium">
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
          onClose={() => setSelectedPhotoId(null)}
          onFindSimilar={handleFindSimilar}
        />
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 ${
        active
          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
          : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </button>
  );
}

export default App;
