import { useState, type FormEvent } from "react";
import { Images, Search } from "lucide-react";
import { motion } from "motion/react";
import type { EventSummary } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";
import { inputClass, primaryButton, staggerContainer, staggerItem } from "../lib/theme";
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
          className={`flex-1 ${inputClass}`}
        />
        <button type="submit" disabled={!query.trim()} className={primaryButton}>
          <Search className="h-3.5 w-3.5" />
          {t("home.searchButton")}
        </button>
      </form>

      <button
        type="button"
        onClick={onAllPhotos}
        className="flex flex-col items-start gap-1 rounded-2xl border border-navy-800 bg-navy-900 p-4 text-left transition-colors hover:border-navy-700"
      >
        <span className="flex items-center gap-1.5 font-serif text-sm font-semibold text-mist-100">
          <Images className="h-3.5 w-3.5 text-blue-400" />
          {t("home.allPhotos")}
        </span>
        <span className="text-xs text-mist-500">{t("home.allPhotosHint")}</span>
      </button>

      <div>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-mist-500">
          {t("home.events")}
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-mist-500">{t("home.noEvents")}</p>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
          >
            {events.map((event) => (
              <motion.button
                key={event.id}
                variants={staggerItem}
                type="button"
                onClick={() => onSelectEvent(event.id)}
                className="flex flex-col items-start gap-1 rounded-2xl border border-navy-800 bg-navy-900 p-3 text-left transition-colors hover:border-navy-700"
              >
                <span className="truncate font-serif text-sm font-medium text-mist-100">
                  {event.name}
                </span>
                <span className="text-xs text-mist-500">
                  {t(
                    event.photoCount === 1
                      ? "home.photoCountOne"
                      : "home.photoCountOther",
                    { count: event.photoCount },
                  )}
                </span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}
