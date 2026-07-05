import type { ReactNode } from "react";
import {
  CalendarDays,
  ChevronDown,
  Hash,
  type LucideIcon,
  MapPin,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  TextSearch,
} from "lucide-react";
import type { EventSummary, LocationSummary, SearchFilters } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";
import { primaryButton, secondaryButton } from "../lib/theme";

const fieldShellClass =
  "flex items-center gap-2 rounded-full border border-navy-700 bg-navy-800 pl-3.5 pr-3 py-1.5";
const bareInputClass =
  "bg-transparent text-sm text-mist-100 outline-none placeholder:text-mist-500";

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
      className="flex flex-wrap items-end gap-3 border border-navy-800 bg-navy-900/40 p-4 m-4 rounded-4xl"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field icon={Hash} label={t("filters.photoId")}>
        <input
          type="text"
          value={filters.customId ?? ""}
          onChange={(event) =>
            update("customId", event.target.value || undefined)
          }
          placeholder={t("photoDetail.idPlaceholder")}
          className={`${bareInputClass} w-24`}
        />
      </Field>

      <SelectField icon={CalendarDays} label={t("filters.event")}>
        <select
          value={filters.eventId ?? ""}
          onChange={(event) =>
            update("eventId", event.target.value || undefined)
          }
          className={`${bareInputClass} w-32 appearance-none pr-4`}
        >
          <option value="" className="bg-navy-800">
            {t("filters.allEvents")}
          </option>
          {events.map((event) => (
            <option key={event.id} value={event.id} className="bg-navy-800">
              {event.name}
            </option>
          ))}
        </select>
      </SelectField>

      <Field icon={CalendarDays} label={t("filters.from")}>
        <input
          type="datetime-local"
          value={filters.from?.slice(0, 16) ?? ""}
          onChange={(event) => update("from", event.target.value || undefined)}
          className={bareInputClass}
        />
      </Field>

      <Field icon={CalendarDays} label={t("filters.to")}>
        <input
          type="datetime-local"
          value={filters.to?.slice(0, 16) ?? ""}
          onChange={(event) => update("to", event.target.value || undefined)}
          className={bareInputClass}
        />
      </Field>

      <SelectField icon={MapPin} label={t("filters.location")}>
        <select
          value={filters.locationId ?? ""}
          onChange={(event) =>
            update("locationId", event.target.value || undefined)
          }
          className={`${bareInputClass} w-32 appearance-none pr-4`}
        >
          <option value="" className="bg-navy-800">
            {t("filters.anywhere")}
          </option>
          {locations.map((location) => (
            <option key={location.id} value={location.id} className="bg-navy-800">
              {location.name}
            </option>
          ))}
        </select>
      </SelectField>

      <Field icon={Radar} label={t("filters.radius")}>
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
          className={`${bareInputClass} w-16`}
        />
      </Field>

      {visualSearchEnabled && (
        <Field icon={Sparkles} label={t("filters.describe")}>
          <input
            type="text"
            value={filters.visualQuery ?? ""}
            onChange={(event) =>
              update("visualQuery", event.target.value || undefined)
            }
            placeholder={t("filters.describePlaceholder")}
            className={`${bareInputClass} w-40`}
          />
        </Field>
      )}

      <Field icon={TextSearch} label={t("filters.sceneText")}>
        <input
          type="text"
          value={filters.sceneText ?? ""}
          onChange={(event) =>
            update("sceneText", event.target.value || undefined)
          }
          placeholder={t("filters.sceneTextPlaceholder")}
          className={`${bareInputClass} w-40`}
        />
      </Field>

      <button type="submit" disabled={isLoading} className={primaryButton}>
        <Search className="h-3.5 w-3.5" />
        {isLoading ? t("filters.searching") : t("filters.search")}
      </button>

      <button
        type="button"
        disabled={isLoading}
        onClick={onSubmit}
        title={t("filters.refreshTitle")}
        className={secondaryButton}
      >
        <RefreshCw className="h-3.5 w-3.5" />
        {t("filters.refresh")}
      </button>
    </form>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-mist-500">{label}</span>
      <span className={fieldShellClass}>
        <Icon className="h-3.5 w-3.5 shrink-0 text-mist-500" />
        {children}
      </span>
    </label>
  );
}

function SelectField({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-mist-500">{label}</span>
      <span className={`${fieldShellClass} relative`}>
        <Icon className="h-3.5 w-3.5 shrink-0 text-mist-500" />
        {children}
        <ChevronDown className="pointer-events-none absolute right-3 h-3 w-3 text-mist-500" />
      </span>
    </label>
  );
}
