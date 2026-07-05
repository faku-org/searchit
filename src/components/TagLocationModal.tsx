import { useState } from "react";
import { AlertTriangle, MapPinPlus, X } from "lucide-react";
import { motion } from "motion/react";
import type { CreateLocationRequestBody } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";
import {
  fieldLabel,
  iconButton,
  inputClass,
  modalBackdrop,
  modalPanel,
  primaryButton,
  secondaryButton,
  springTransition,
} from "../lib/theme";

interface TagLocationModalProps {
  initialLat?: number;
  initialLon?: number;
  onClose: () => void;
  onCreate: (body: CreateLocationRequestBody) => Promise<void>;
}

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
    <motion.div
      className={modalBackdrop}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={springTransition}
        className={`${modalPanel} max-w-sm`}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-mist-100">
            <MapPinPlus className="h-4 w-4 text-blue-400" />
            {t("tagLocation.title")}
          </h2>
          <button type="button" onClick={onClose} className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-rose-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>{t("tagLocation.name")}</span>
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
          <label className="flex flex-1 flex-col gap-1">
            <span className={fieldLabel}>{t("tagLocation.latitude")}</span>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={fieldLabel}>{t("tagLocation.longitude")}</span>
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
          <button type="button" onClick={onClose} className={secondaryButton}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={isBusy || !isValid} className={primaryButton}>
            {isBusy ? t("common.saving") : t("tagLocation.save")}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
