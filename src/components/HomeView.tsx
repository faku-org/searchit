import { useState, type FormEvent } from "react";
import type { EventSummary } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";
import { IngestProgress } from "./IngestProgress";

interface HomeViewProps {
  events: EventSummary[];
  onSearch: (query: string) => void;
  onAllPhotos: () => void;
  onSelectEvent: (eventId: string) => void;
}

/** Landing screen: a smart search box, an "all photos" shortcut, and event cards to switch between. */
export function HomeView({
  events,
  onSearch,
  onAllPhotos,
  onSelectEvent,
}: HomeViewProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    onSearch(query.trim());
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      <IngestProgress />

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("home.searchPlaceholder")}
          autoFocus
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
        <button
          type="submit"
          disabled={!query.trim()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {t("home.searchButton")}
        </button>
      </form>

      <button
        type="button"
        onClick={onAllPhotos}
        className="flex flex-col items-start gap-1 rounded-lg border border-neutral-200 p-4 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
      >
        <span className="text-sm font-semibold">{t("home.allPhotos")}</span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("home.allPhotosHint")}
        </span>
      </button>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {t("home.events")}
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {t("home.noEvents")}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => onSelectEvent(event.id)}
                className="flex flex-col items-start gap-1 rounded-lg border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="truncate text-sm font-medium">
                  {event.name}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">
                  {t(
                    event.photoCount === 1
                      ? "home.photoCountOne"
                      : "home.photoCountOther",
                    { count: event.photoCount },
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
