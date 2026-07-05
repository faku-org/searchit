import { FolderOpen, ImagePlus, X } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "../lib/i18n";
import { openFolder } from "../lib/tauri";
import {
  iconButton,
  modalBackdrop,
  modalPanel,
  primaryButton,
  secondaryButton,
  springTransition,
} from "../lib/theme";

interface ImportPhotosModalProps {
  eventName: string;
  folderPath: string;
  onClose: () => void;
}

/**
 * Shown right after creating an event: the watcher already scopes ingest by
 * subfolder name (see server/src/ingest/watcher.ts), so this folder is ready
 * to receive files immediately -- no need to explain slugs or folder naming
 * to the user, just point them at the path.
 */
export function ImportPhotosModal({ eventName, folderPath, onClose }: ImportPhotosModalProps) {
  const { t } = useTranslation();

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
        className={`${modalPanel} max-w-sm`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-mist-100">
            <ImagePlus className="h-4 w-4 text-blue-400" />
            {t("importPhotos.title")}
          </h2>
          <button type="button" onClick={onClose} className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-mist-300">
          {t("importPhotos.body", { eventName })}
        </p>

        <p className="break-all rounded-xl border border-navy-700 bg-navy-800 px-3 py-2 text-xs text-mist-100">
          {folderPath}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={secondaryButton}>
            {t("common.close")}
          </button>
          <button
            type="button"
            onClick={() => void openFolder(folderPath)}
            className={primaryButton}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("importPhotos.openFolder")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
