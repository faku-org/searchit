import { useEffect, useState } from "react";
import type {
  BoundingBox,
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
  setPhotoCustomId,
  splitFace,
} from "../lib/api";
import { statusLabel, useTranslation } from "../lib/i18n";
import { revealInFileManager } from "../lib/tauri";
import { RegionSelector } from "./RegionSelector";

const PENDING_POLL_INTERVAL_MS = 5000;

interface PhotoDetailPanelProps {
  photoId: string;
  onClose: () => void;
  onFindSimilar: (sourcePhotoId: string, results: PhotoSummary[]) => void;
  visualSearchEnabled: boolean;
  faceRecognitionEnabled: boolean;
}

export function PhotoDetailPanel({
  photoId,
  onClose,
  onFindSimilar,
  visualSearchEnabled,
  faceRecognitionEnabled,
}: PhotoDetailPanelProps) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<PhotoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [customIdInput, setCustomIdInput] = useState("");

  function loadDetail() {
    getPhotoDetail(photoId)
      .then((loaded) => {
        setDetail(loaded);
        setCustomIdInput(loaded.customId ?? "");
      })
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

  async function handleSaveCustomId() {
    if (!detail) return;
    setIsBusy(true);
    setError(null);
    try {
      setDetail(await setPhotoCustomId(detail.id, customIdInput || null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

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

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-200 p-3 dark:border-neutral-800">
          <span className="text-sm font-medium">
            {detail?.filename ?? t("photoDetail.loading")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t("common.close")}
          </button>
        </div>

        {error && <p className="p-4 text-sm text-red-600">{error}</p>}

        {detail && (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div>
              <RegionSelector
                src={previewUrl(detail.id)}
                alt={detail.filename}
                onSelect={(bbox, action) => void handleSelectRegion(bbox, action)}
                visualSearchEnabled={visualSearchEnabled}
                faceRecognitionEnabled={faceRecognitionEnabled}
              />
              <p className="mt-1 text-xs text-neutral-500">
                {t("photoDetail.regionHint")}
                {isBusy && t("photoDetail.working")}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-neutral-500">{t("photoDetail.takenAt")}</dt>
              <dd>
                {detail.takenAt
                  ? new Date(detail.takenAt).toLocaleString()
                  : t("common.unknown")}
              </dd>

              <dt className="text-neutral-500">{t("photoDetail.gps")}</dt>
              <dd>
                {detail.gpsLat !== null && detail.gpsLon !== null
                  ? `${detail.gpsLat.toFixed(5)}, ${detail.gpsLon.toFixed(5)}`
                  : t("photoDetail.noGps")}
              </dd>

              <dt className="text-neutral-500">{t("photoDetail.camera")}</dt>
              <dd>{detail.cameraModel ?? t("common.unknown")}</dd>

              <dt className="text-neutral-500">{t("photoDetail.photoId")}</dt>
              <dd className="flex items-center gap-2">
                <input
                  type="text"
                  value={customIdInput}
                  onChange={(event) => setCustomIdInput(event.target.value)}
                  placeholder={t("photoDetail.idPlaceholder")}
                  className="w-28 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
                <button
                  type="button"
                  disabled={isBusy || customIdInput === (detail.customId ?? "")}
                  onClick={() => void handleSaveCustomId()}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
                >
                  {t("common.save")}
                </button>
              </dd>

              <dt className="text-neutral-500">{t("photoDetail.status")}</dt>
              <dd className="capitalize">{statusLabel(t, detail.status)}</dd>

              {detail.recognizedText && (
                <>
                  <dt className="text-neutral-500">
                    {t("photoDetail.textInPhoto")}
                  </dt>
                  <dd>{detail.recognizedText}</dd>
                </>
              )}
            </dl>

            {detail.status === "failed" && detail.errorMessage && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                <p className="font-medium">{t("photoDetail.failureReason")}</p>
                <p className="mt-1 break-words">{detail.errorMessage}</p>
              </div>
            )}

            <details className="rounded-md border border-neutral-200 text-sm dark:border-neutral-800">
              <summary className="cursor-pointer select-none px-3 py-2 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
                {t("photoDetail.devInfoToggle")}
              </summary>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-neutral-200 p-3 dark:border-neutral-800">
                <dt className="text-neutral-500">
                  {t("photoDetail.dateSource")}
                </dt>
                <dd>
                  {detail.takenAtSource === "exif"
                    ? t("photoDetail.dateSourceExif")
                    : detail.takenAtSource === "filesystem"
                      ? t("photoDetail.dateSourceFilesystem")
                      : t("common.unknown")}
                </dd>

                <dt className="text-neutral-500">
                  {t("photoDetail.hasImageEmbedding")}
                </dt>
                <dd>{detail.hasImageEmbedding ? t("common.yes") : t("common.no")}</dd>

                <dt className="text-neutral-500">
                  {t("photoDetail.faceCount")}
                </dt>
                <dd>{detail.faces.length}</dd>
              </dl>
            </details>

            {detail.faces.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm text-neutral-500">
                  {t("photoDetail.peopleInPhoto")}
                </span>
                <div className="flex flex-wrap gap-3">
                  {detail.faces.map((face) => (
                    <div
                      key={face.id}
                      className="flex flex-col items-center gap-1"
                    >
                      <img
                        src={resolveApiUrl(face.thumbnailUrl)}
                        alt={t("photoDetail.detectedFace")}
                        className="h-16 w-16 rounded object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSplit(face.id)}
                        className="text-[11px] text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
                      >
                        {t("photoDetail.notThisPerson")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void revealInFileManager(detail.originalPath)}
                className="self-start rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                {t("photoDetail.revealOriginal")}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleReprocess()}
                className="self-start rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200"
              >
                {t("photoDetail.reprocess")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
