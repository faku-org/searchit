import { useMemo } from "react";
import { Clock, XCircle } from "lucide-react";
import { motion } from "motion/react";
import type { PhotoSummary } from "@searchit/shared";
import { previewUrl } from "../lib/api";
import { statusLabel, useTranslation } from "../lib/i18n";
import { staggerContainer, staggerItem } from "../lib/theme";
import { useSquircleClipPath } from "../lib/useSquircleClipPath";

interface ResultsGridProps {
  photos: PhotoSummary[];
  onSelect: (photo: PhotoSummary) => void;
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

export function ResultsGrid({ photos, onSelect }: ResultsGridProps) {
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

  const shortDateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US"),
    [locale],
  );

  const groups = useMemo(
    () => groupByLocalDate(photos, dateFormatter, t("results.unknownDate")),
    [photos, dateFormatter, t],
  );

  if (photos.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-mist-500">
        {t("results.empty")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {groups.map((group) => (
        <section key={group.key} className="mb-6 last:mb-0">
          <h3 className="sticky top-0 z-10 mb-2 block w-fit mx-auto rounded-2xl border border-navy-700/40 bg-navy-950/60 backdrop-blur-3xl px-4 py-1.5 text-xs font-semibold text-mist-500">
            {group.label}
          </h3>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3"
          >
            {group.photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                dateLabel={
                  photo.takenAt ? shortDateFormatter.format(new Date(photo.takenAt)) : null
                }
                onSelect={onSelect}
              />
            ))}
          </motion.div>
        </section>
      ))}
    </div>
  );
}

// A photo whose long edge beats its short edge by this much reads as
// wide/ultra-wide (16:9 and beyond) rather than a standard landscape shot,
// so it gets to keep its horizontal shape instead of being cropped to the
// grid's default card shape.
const WIDE_ASPECT_RATIO = 16 / 9;

// Figma spec: cards are 280x309 (portrait/standard) or 600x309 (wide/ultra-
// wide, spanning two grid columns) -- same row height either way, width
// carries the aspect ratio. 42px corner radius at iOS-level (60%) smoothing.
const CARD_ASPECT_RATIO = "280/309";
const WIDE_CARD_ASPECT_RATIO = "600/309";
const SQUIRCLE_CORNER_RADIUS = 32;
const SQUIRCLE_CORNER_SMOOTHING = 0.6;

function PhotoCard({
  photo,
  dateLabel,
  onSelect,
}: {
  photo: PhotoSummary;
  dateLabel: string | null;
  onSelect: (photo: PhotoSummary) => void;
}) {
  const { t } = useTranslation();

  const isWide =
    photo.width !== null &&
    photo.height !== null &&
    photo.width / photo.height >= WIDE_ASPECT_RATIO;

  const { ref: squircleRef, clipPath } = useSquircleClipPath<HTMLButtonElement>({
    cornerRadius: SQUIRCLE_CORNER_RADIUS,
    cornerSmoothing: SQUIRCLE_CORNER_SMOOTHING,
  });

  return (
    <motion.button
      ref={squircleRef}
      type="button"
      variants={staggerItem}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(photo)}
      style={{
        clipPath,
        aspectRatio: isWide ? WIDE_CARD_ASPECT_RATIO : CARD_ASPECT_RATIO,
      }}
      className={`group relative flex flex-col overflow-hidden bg-navy-900 text-left shadow-[inset_0_0_0_1px_var(--color-navy-800)] ${
        isWide ? "sm:col-span-2" : ""
      }`}
    >
      <img
        src={previewUrl(photo.id)}
        alt={photo.filename}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-navy-950/95 via-navy-950/40 to-transparent" />

      {photo.status === "pending" && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-navy-950">
          <Clock className="h-2.5 w-2.5" />
          {statusLabel(t, photo.status)}
        </span>
      )}
      {photo.status === "failed" && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-mist-100">
          <XCircle className="h-2.5 w-2.5" />
          {statusLabel(t, photo.status)}
        </span>
      )}

      <div className="relative mt-auto flex flex-col gap-0.5 p-3">
        <span className="truncate font-serif text-base font-semibold text-mist-100">
          {photo.customId ? `#${photo.customId}` : photo.filename}
        </span>
        {dateLabel && <span className="text-xs text-mist-300">{dateLabel}</span>}
      </div>
    </motion.button>
  );
}
