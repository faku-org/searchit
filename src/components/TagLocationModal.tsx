import { useState } from "react";
import type { CreateLocationRequestBody } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";

interface TagLocationModalProps {
  initialLat?: number;
  initialLon?: number;
  onClose: () => void;
  onCreate: (body: CreateLocationRequestBody) => Promise<void>;
}

const inputClass =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

export function TagLocationModal({
  initialLat,
  initialLon,
  onClose,
  onCreate,
}: TagLocationModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [lat, setLat] = useState(initialLat?.toString() ?? "");
  const [lon, setLon] = useState(initialLon?.toString() ?? "");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latNumber = Number(lat);
  const lonNumber = Number(lon);
  const isValid =
    name.trim().length > 0 &&
    lat.trim().length > 0 &&
    lon.trim().length > 0 &&
    !Number.isNaN(latNumber) &&
    !Number.isNaN(lonNumber);

  async function handleSubmit() {
    if (!isValid) return;
    setIsBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), lat: latNumber, lon: lonNumber });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <form
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-white p-4 dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <h2 className="text-sm font-semibold">{t("tagLocation.title")}</h2>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("tagLocation.name")}
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("tagLocation.namePlaceholder")}
            autoFocus
            className={inputClass}
          />
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("tagLocation.latitude")}
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {t("tagLocation.longitude")}
            <input
              type="number"
              step="any"
              value={lon}
              onChange={(event) => setLon(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={isBusy || !isValid}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {isBusy ? t("common.saving") : t("tagLocation.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
