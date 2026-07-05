import type { ReactNode } from "react";
import type { EventSummary, LocationSummary, SearchFilters } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";

const inputClass =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

interface SearchFiltersPanelProps {
  events: EventSummary[];
  locations: LocationSummary[];
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  onSubmit: () => void;
  isLoading: boolean;
  /** Whether CLIP-based visual/text search is enabled -- hides the "describe what you're looking for" field when off, since it has no embeddings to search against. */
  visualSearchEnabled: boolean;
}

export function SearchFiltersPanel({
  events,
  locations,
  filters,
  onChange,
  onSubmit,
  isLoading,
  visualSearchEnabled,
}: SearchFiltersPanelProps) {
  const { t } = useTranslation();

  function update<K extends keyof SearchFilters>(
    key: K,
    value: SearchFilters[K],
  ) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 border-b border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field label={t("filters.photoId")}>
        <input
          type="text"
          value={filters.customId ?? ""}
          onChange={(event) =>
            update("customId", event.target.value || undefined)
          }
          placeholder={t("photoDetail.idPlaceholder")}
          className={inputClass}
        />
      </Field>

      <Field label={t("filters.event")}>
        <select
          value={filters.eventId ?? ""}
          onChange={(event) =>
            update("eventId", event.target.value || undefined)
          }
          className={inputClass}
        >
          <option value="">{t("filters.allEvents")}</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("filters.from")}>
        <input
          type="datetime-local"
          value={filters.from?.slice(0, 16) ?? ""}
          onChange={(event) => update("from", event.target.value || undefined)}
          className={inputClass}
        />
      </Field>

      <Field label={t("filters.to")}>
        <input
          type="datetime-local"
          value={filters.to?.slice(0, 16) ?? ""}
          onChange={(event) => update("to", event.target.value || undefined)}
          className={inputClass}
        />
      </Field>

      <Field label={t("filters.location")}>
        <select
          value={filters.locationId ?? ""}
          onChange={(event) =>
            update("locationId", event.target.value || undefined)
          }
          className={inputClass}
        >
          <option value="">{t("filters.anywhere")}</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("filters.radius")}>
        <input
          type="number"
          step="any"
          min="0"
          value={filters.radiusKm ?? ""}
          onChange={(event) =>
            update(
              "radiusKm",
              event.target.value ? Number(event.target.value) : undefined,
            )
          }
          className={`${inputClass} w-24`}
        />
      </Field>

      {visualSearchEnabled && (
        <Field label={t("filters.describe")}>
          <input
            type="text"
            value={filters.visualQuery ?? ""}
            onChange={(event) =>
              update("visualQuery", event.target.value || undefined)
            }
            placeholder={t("filters.describePlaceholder")}
            className={`${inputClass} w-40`}
          />
        </Field>
      )}

      <Field label={t("filters.sceneText")}>
        <input
          type="text"
          value={filters.sceneText ?? ""}
          onChange={(event) =>
            update("sceneText", event.target.value || undefined)
          }
          placeholder={t("filters.sceneTextPlaceholder")}
          className={`${inputClass} w-40`}
        />
      </Field>

      <button
        type="submit"
        disabled={isLoading}
        className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {isLoading ? t("filters.searching") : t("filters.search")}
      </button>

      <button
        type="button"
        disabled={isLoading}
        onClick={onSubmit}
        title={t("filters.refreshTitle")}
        className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
      >
        {t("filters.refresh")}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
      {label}
      {children}
    </label>
  );
}
