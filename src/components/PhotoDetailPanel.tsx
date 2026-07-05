import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Camera,
  FolderOpen,
  MapPin,
  RotateCw,
  ScanText,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import type {
  BoundingBox,
  LocationSummary,
  PhotoDetail,
  PhotoSummary,
  SelectRegionAction,
} from "@searchit/shared";
import {
  getPhotoDetail,
  previewUrl,
  reprocessPhoto,
  resolveApiUrl,
  selectRegion,
  splitFace,
} from "../lib/api";
import { findNearestLocation } from "../lib/geo";
import { statusLabel, useTranslation } from "../lib/i18n";
import { revealInFileManager } from "../lib/tauri";
import {
  iconButton,
  modalBackdrop,
  primaryButton,
  secondaryButton,
  springTransition,
} from "../lib/theme";
import { RegionSelector } from "./RegionSelector";

const PENDING_POLL_INTERVAL_MS = 5000;
// A photo's GPS fix and a hand-tagged location rarely line up exactly, so
// anything within this radius is treated as "taken at" that named spot.
const NEAREST_LOCATION_MAX_KM = 0.3;

interface PhotoDetailPanelProps {
  photoId: string;
  locations: LocationSummary[];
  onClose: () => void;
  onFindSimilar: (sourcePhotoId: string, results: PhotoSummary[]) => void;
}

const STATUS_STYLES: Record<PhotoDetail["status"], string> = {
  processed: "bg-emerald-500/20 text-emerald-300",
  pending: "bg-amber-400/20 text-amber-300",
  failed: "bg-rose-500/20 text-rose-300",
};

export function PhotoDetailPanel({
  photoId,
  locations,
  onClose,
  onFindSimilar,
}: PhotoDetailPanelProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PhotoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  function loadDetail() {
    getPhotoDetail(photoId)
      .then(setDetail)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
  }

  useEffect(() => {
    setDetail(null);
    setError(null);
    loadDetail();
  }, [photoId]);

  // The ingest pipeline finishes asynchronously, so a photo opened right
  // after upload can still be "pending" -- keep polling until it settles
  // instead of making the user close and reopen the panel to see results.
  useEffect(() => {
    if (detail?.status !== "pending") return;
    const id = setInterval(loadDetail, PENDING_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [photoId, detail?.status]);

  async function handleSplit(faceId: string) {
    try {
      await splitFace(faceId);
      loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReprocess() {
    if (!detail) return;
    setIsBusy(true);
    setError(null);
    try {
      setDetail(await reprocessPhoto(detail.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSelectRegion(bbox: BoundingBox, action: SelectRegionAction) {
    if (!detail) return;
    setIsBusy(true);
    setError(null);
    try {
      const response = await selectRegion(detail.id, bbox, action);
      if (response.action === "face") {
        loadDetail();
      } else {
        onFindSimilar(detail.id, response.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  const isPortrait =
    detail?.width && detail?.height ? detail.height > detail.width : false;

  const nearestLocation =
    detail?.gpsLat !== undefined &&
    detail?.gpsLat !== null &&
    detail?.gpsLon !== null &&
    detail
      ? findNearestLocation(detail.gpsLat, detail.gpsLon, locations, NEAREST_LOCATION_MAX_KM)
      : null;

  return (
    <motion.div
      className={modalBackdrop}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={springTransition}
        onClick={(event) => event.stopPropagation()}
        className={`relative flex max-h-full w-full flex-col overflow-y-auto rounded-4xl border border-navy-800 bg-navy-900 p-6 ${
          isPortrait ? "max-w-4xl" : "max-w-3xl"
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          className={`${iconButton} absolute right-4 top-4 z-10 bg-navy-950/70 backdrop-blur-2xl`}
        >
          <X className="h-4 w-4" />
        </button>

        {error && (
          <p className="mb-3 flex items-center gap-2 text-sm text-rose-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}

        {!detail && <p className="text-sm text-mist-500">{t("photoDetail.loading")}</p>}

        {detail && (
          <div className={isPortrait ? "flex flex-col gap-6 md:flex-row" : "flex flex-col gap-6"}>
            <div className={isPortrait ? "shrink-0 md:w-[45%]" : "w-full"}>
              <RegionSelector
                src={previewUrl(detail.id)}
                alt={detail.filename}
                onSelect={(bbox, action) => void handleSelectRegion(bbox, action)}
                imageClassName={
                  isPortrait
                    ? "block max-h-[70vh] w-full rounded-xl object-contain"
                    : "block max-h-[50vh] w-full rounded-xl object-contain"
                }
              />
              <p className="mt-2 text-xs text-mist-500">
                {t("photoDetail.regionHint")}
                {isBusy && t("photoDetail.working")}
              </p>
            </div>

            <div
              className={
                isPortrait
                  ? "flex flex-1 flex-col gap-5"
                  : "grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2"
              }
            >
              <div className="flex min-w-0 flex-col gap-3">
                <div className="min-w-0">
                  <h2
                    className="truncate pr-10 font-serif text-2xl font-semibold text-mist-100"
                    title={detail.customId ? `#${detail.customId}` : detail.filename}
                  >
                    {detail.customId ? `#${detail.customId}` : detail.filename}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-mist-500">
                    <span>
                      {detail.takenAt
                        ? new Date(detail.takenAt).toLocaleString()
                        : t("common.unknown")}
                    </span>
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-[11px] font-medium text-mist-500">
                    {t("photoDetail.takenAt")}
                  </p>
                  {nearestLocation ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-navy-700 bg-navy-800 px-3 py-1 text-sm font-medium text-mist-100">
                      {nearestLocation.name}
                      <MapPin className="h-3.5 w-3.5 text-blue-400" />
                    </span>
                  ) : detail.gpsLat !== null && detail.gpsLon !== null ? (
                    <span className="text-sm text-mist-300">
                      {detail.gpsLat.toFixed(5)}, {detail.gpsLon.toFixed(5)}
                    </span>
                  ) : (
                    <span className="text-sm text-mist-500">{t("photoDetail.noGps")}</span>
                  )}
                </div>

                {detail.faces.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium text-mist-500">
                      {t("photoDetail.peopleInPhoto")}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {detail.faces.map((face) => (
                        <div key={face.id} className="flex flex-col items-center gap-1">
                          <img
                            src={resolveApiUrl(face.thumbnailUrl)}
                            alt={t("photoDetail.detectedFace")}
                            className="squircle h-14 w-14 object-cover shadow-[inset_0_0_0_1px_var(--color-navy-700)]"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSplit(face.id)}
                            className="text-[11px] text-mist-500 underline hover:text-mist-300"
                          >
                            {t("photoDetail.notThisPerson")}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1 text-[11px] font-medium text-mist-500">
                    {t("photoDetail.status")}
                  </p>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[detail.status]}`}
                  >
                    {statusLabel(t, detail.status)}
                  </span>
                </div>

                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-mist-500">
                    <Camera className="h-3 w-3" />
                    {t("photoDetail.camera")}
                  </p>
                  <p className="text-sm text-mist-100">
                    {detail.cameraModel ?? t("common.unknown")}
                    {detail.width && detail.height && (
                      <span className="text-mist-500"> · {detail.width}×{detail.height}</span>
                    )}
                  </p>
                </div>

                {detail.recognizedText && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-mist-500">
                      <ScanText className="h-3 w-3" />
                      {t("photoDetail.textInPhoto")}
                    </p>
                    <p className="text-sm text-mist-100">{detail.recognizedText}</p>
                  </div>
                )}

                <div className="mt-auto flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => void revealInFileManager(detail.originalPath)}
                    className={primaryButton}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t("photoDetail.revealOriginal")}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleReprocess()}
                    className={secondaryButton}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    {t("photoDetail.reprocess")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
