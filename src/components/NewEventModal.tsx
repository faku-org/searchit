import { useState } from "react";
import type { CreateEventRequestBody } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";

interface NewEventModalProps {
  onClose: () => void;
  onCreate: (body: CreateEventRequestBody) => Promise<void>;
}

const inputClass =
  "rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100";

export function NewEventModal({ onClose, onCreate }: NewEventModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) return;
    setIsBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), startsAt: startsAt || undefined });
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
        <h2 className="text-sm font-semibold">{t("newEvent.title")}</h2>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("newEvent.name")}
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("newEvent.namePlaceholder")}
            autoFocus
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {t("newEvent.date")}
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className={inputClass}
          />
        </label>

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
            disabled={isBusy || !name.trim()}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {isBusy ? t("common.creating") : t("common.create")}
          </button>
        </div>
      </form>
    </div>
  );
}
