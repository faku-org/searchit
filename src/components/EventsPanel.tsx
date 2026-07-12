import { useState } from "react";
import { motion } from "motion/react";
import type {
  EventCategory,
  EventSummary,
  UpdateEventRequestBody,
  UpdateEventResponseBody,
} from "@searchit/shared";
import { useTranslation } from "../lib/i18n";
import {
  card,
  fieldLabel,
  inputClass,
  primaryButton,
  secondaryButton,
  staggerContainer,
  staggerItem,
} from "../lib/theme";
import { useToast } from "../lib/toast";
import { WeightSlider } from "./WeightSlider";

const CATEGORY_LABEL_KEYS: Record<
  EventCategory,
  "newEvent.categorySports" | "newEvent.categoryVacation" | "newEvent.categoryGeneral" | "newEvent.categoryCustom"
> = {
  sports: "newEvent.categorySports",
  vacation: "newEvent.categoryVacation",
  general: "newEvent.categoryGeneral",
  custom: "newEvent.categoryCustom",
};

const CATEGORY_BADGE_CLASSES: Record<EventCategory, string> = {
  sports: "bg-amber-400/20 text-amber-300",
  vacation: "bg-ice-200/20 text-ice-200",
  general: "bg-navy-800 text-mist-300",
  custom: "bg-blue-500/20 text-blue-300",
};

interface EventsPanelProps {
  events: EventSummary[];
  onUpdate: (id: string, body: UpdateEventRequestBody) => Promise<UpdateEventResponseBody>;
}

export function EventsPanel({ events, onUpdate }: EventsPanelProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState<EventCategory>("general");
  const [customOcrMinConfidence, setCustomOcrMinConfidence] = useState("0.5");
  const [customFaceMatchMaxDistance, setCustomFaceMatchMaxDistance] = useState("0.6");
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(event: EventSummary) {
    setEditingId(event.id);
    setCategory(event.category);
    setCustomOcrMinConfidence(String(event.customOcrMinConfidence ?? 0.5));
    setCustomFaceMatchMaxDistance(String(event.customFaceMatchMaxDistance ?? 0.6));
  }

  async function handleSave(id: string) {
    setIsSaving(true);
    try {
      const result = await onUpdate(id, {
        category,
        ...(category === "custom"
          ? {
              customOcrMinConfidence: Number(customOcrMinConfidence),
              customFaceMatchMaxDistance: Number(customFaceMatchMaxDistance),
            }
          : {}),
      });
      setEditingId(null);
      showToast(
        result.reprocessQueued > 0
          ? t(
              result.reprocessQueued === 1
                ? "events.reprocessQueuedOne"
                : "events.reprocessQueuedOther",
              { count: result.reprocessQueued },
            )
          : t("events.updated"),
        "success",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsSaving(false);
    }
  }

  if (events.length === 0) {
    return <p className="p-6 text-sm text-mist-500">{t("events.empty")}</p>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mx-auto flex max-w-2xl flex-col gap-2"
      >
        {events.map((event) => (
          <motion.li key={event.id} variants={staggerItem} className={card}>
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-serif text-base font-semibold text-mist-100">
                  {event.name}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-mist-500">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_BADGE_CLASSES[event.category]}`}
                  >
                    {t(CATEGORY_LABEL_KEYS[event.category])}
                  </span>
                  {event.startsAt && <span>{new Date(event.startsAt).toLocaleDateString()}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  editingId === event.id ? setEditingId(null) : startEdit(event)
                }
                className={secondaryButton}
              >
                {editingId === event.id ? t("common.cancel") : t("events.editMode")}
              </button>
            </div>

            {editingId === event.id && (
              <div className="flex flex-col gap-3 border-t border-navy-800 p-4">
                <label className="flex flex-col gap-1">
                  <span className={fieldLabel}>{t("newEvent.category")}</span>
                  <select
                    value={category}
                    onChange={(changeEvent) =>
                      setCategory(changeEvent.target.value as EventCategory)
                    }
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

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleSave(event.id)}
                    className={primaryButton}
                  >
                    {isSaving ? t("events.applying") : t("events.applyMode")}
                  </button>
                </div>
              </div>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
