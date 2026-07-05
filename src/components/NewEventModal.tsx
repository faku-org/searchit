import { useState } from "react";
import { AlertTriangle, CalendarPlus, X } from "lucide-react";
import { motion } from "motion/react";
import type { CreateEventRequestBody, EventCategory } from "@searchit/shared";
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
import { WeightSlider } from "./WeightSlider";

interface NewEventModalProps {
  onClose: () => void;
  onCreate: (body: CreateEventRequestBody) => Promise<void>;
}

export function NewEventModal({ onClose, onCreate }: NewEventModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [category, setCategory] = useState<EventCategory>("general");
  const [customOcrMinConfidence, setCustomOcrMinConfidence] = useState("0.5");
  const [customFaceMatchMaxDistance, setCustomFaceMatchMaxDistance] = useState("0.6");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) return;
    setIsBusy(true);
    setError(null);
    try {
      await onCreate({
        name: name.trim(),
        startsAt: startsAt || undefined,
        category,
        ...(category === "custom"
          ? {
              customOcrMinConfidence: Number(customOcrMinConfidence),
              customFaceMatchMaxDistance: Number(customFaceMatchMaxDistance),
            }
          : {}),
      });
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
            <CalendarPlus className="h-4 w-4 text-blue-400" />
            {t("newEvent.title")}
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
          <span className={fieldLabel}>{t("newEvent.name")}</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("newEvent.namePlaceholder")}
            autoFocus
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>{t("newEvent.date")}</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>{t("newEvent.category")}</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as EventCategory)}
            className={inputClass}
          >
            <option value="sports">{t("newEvent.categorySports")}</option>
            <option value="vacation">{t("newEvent.categoryVacation")}</option>
            <option value="general">{t("newEvent.categoryGeneral")}</option>
            <option value="custom">{t("newEvent.categoryCustom")}</option>
          </select>
        </label>

        {category === "custom" && (
          <>
            <WeightSlider
              label={t("newEvent.customOcrConfidence")}
              hint={t("newEvent.customOcrConfidenceHint")}
              min={0}
              max={1}
              step={0.05}
              value={customOcrMinConfidence}
              onChange={setCustomOcrMinConfidence}
            />

            <WeightSlider
              label={t("newEvent.customFaceMatchDistance")}
              hint={t("newEvent.customFaceMatchDistanceHint")}
              min={0}
              max={2}
              step={0.05}
              value={customFaceMatchMaxDistance}
              onChange={setCustomFaceMatchMaxDistance}
            />
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={secondaryButton}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={isBusy || !name.trim()} className={primaryButton}>
            {isBusy ? t("common.creating") : t("common.create")}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
