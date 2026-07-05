import { useMemo } from "react";
import type { PhotoSummary } from "@searchit/shared";
import { previewUrl } from "../lib/api";
import { statusLabel, useTranslation } from "../lib/i18n";

interface ResultsGridProps {
  photos: PhotoSummary[];
  onSelect: (photo: PhotoSummary) => void;
  tourId?: string;
}

interface PhotoGroup {
  key: string;
  label: string;
  photos: PhotoSummary[];
}

/**
 * Buckets by the viewer's local calendar day (not the raw UTC date stored on
 * the photo), so a photo taken late at night doesn't land under the wrong day
 * just because it crossed midnight UTC. Order of first appearance is kept,
 * which matches the grid's incoming sort (date descending by default, or
 * similarity rank during a visual/face search).
 */
function groupByLocalDate(
  photos: PhotoSummary[],
  dateFormatter: Intl.DateTimeFormat,
  unknownDateLabel: string,
): PhotoGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, { date: Date | null; photos: PhotoSummary[] }>();

  for (const photo of photos) {
    const date = photo.takenAt ? new Date(photo.takenAt) : null;
    const key = date
      ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      : "unknown";

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { date, photos: [] };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.photos.push(photo);
  }

  return order.map((key) => {
    const bucket = buckets.get(key)!;
    return {
      key,
      label: bucket.date ? dateFormatter.format(bucket.date) : unknownDateLabel,
      photos: bucket.photos,
    };
  });
}

export function ResultsGrid({ photos, onSelect, tourId }: ResultsGridProps) {
  const { t, locale } = useTranslation();

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    [locale],
  );

  const groups = useMemo(
    () => groupByLocalDate(photos, dateFormatter, t("results.unknownDate")),
    [photos, dateFormatter, t],
  );

  if (photos.length === 0) {
    return (
      <div
        data-tour={tourId}
        className="flex flex-1 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400"
      >
        {t("results.empty")}
      </div>
    );
  }

  return (
    <div data-tour={tourId} className="flex-1 overflow-y-auto p-4">
      {groups.map((group) => (
        <section key={group.key} className="mb-6 last:mb-0">
          <h3 className="sticky top-0 z-10 -mx-4 mb-2 bg-neutral-50/95 px-4 py-1.5 text-xs font-semibold text-neutral-500 backdrop-blur-sm dark:bg-neutral-950/95 dark:text-neutral-400">
            {group.label}
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {group.photos.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PhotoCard({
  photo,
  onSelect,
}: {
  photo: PhotoSummary;
  onSelect: (photo: PhotoSummary) => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={() => onSelect(photo)}
      className="group flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white text-left shadow-sm transition hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="aspect-square w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        <img
          src={previewUrl(photo.id)}
          alt={photo.filename}
          loading="lazy"
          className="h-full w-full object-cover transition group-hover:scale-105"
        />
      </div>
      <div className="flex flex-col gap-1 p-2">
        <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {photo.filename}
        </span>
        <div className="flex flex-wrap gap-1">
          {photo.customId && (
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
              #{photo.customId}
            </span>
          )}
          {photo.status !== "processed" && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              {statusLabel(t, photo.status)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
