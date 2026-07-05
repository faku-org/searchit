import { useRef, useState } from "react";
import { AlertTriangle, ScanFace, Upload, X } from "lucide-react";
import { motion } from "motion/react";
import type { FaceMatchCandidate, IdentitySummary } from "@searchit/shared";
import { matchFace, resolveApiUrl } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import {
  iconButton,
  modalBackdrop,
  modalPanel,
  secondaryButton,
  springTransition,
  staggerContainer,
  staggerItem,
} from "../lib/theme";

interface IdentifyByPhotoModalProps {
  onClose: () => void;
  onOpenIdentity: (identity: IdentitySummary) => void;
  onRename: (id: string, displayName: string | null) => void;
}

export function IdentifyByPhotoModal({
  onClose,
  onOpenIdentity,
  onRename,
}: IdentifyByPhotoModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isMatching, setIsMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FaceMatchCandidate[] | null>(
    null,
  );

  async function handleFileSelected(file: File) {
    setFilePreviewUrl(URL.createObjectURL(file));
    setCandidates(null);
    setError(null);
    setIsMatching(true);
    try {
      const response = await matchFace(file);
      setCandidates(response.candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMatching(false);
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
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={springTransition}
        className={`${modalPanel} max-w-md`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-mist-100">
            <ScanFace className="h-4 w-4 text-blue-400" />
            {t("identify.title")}
          </h2>
          <button type="button" onClick={onClose} className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-mist-500">{t("identify.prompt")}</p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileSelected(file);
          }}
        />

        <div className="flex items-center gap-3">
          {filePreviewUrl && (
            <img
              src={filePreviewUrl}
              alt=""
              className="h-16 w-16 rounded-xl object-cover"
            />
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={secondaryButton}
          >
            <Upload className="h-3.5 w-3.5" />
            {filePreviewUrl ? t("identify.anotherFile") : t("identify.chooseFile")}
          </button>
        </div>

        {isMatching && <p className="text-sm text-mist-500">{t("identify.matching")}</p>}

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-rose-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        {candidates && candidates.length === 0 && !error && (
          <p className="text-sm text-mist-500">{t("identify.noCandidates")}</p>
        )}

        {candidates && candidates.length > 0 && (
          <motion.ul
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-2"
          >
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.identityId}
                candidate={candidate}
                onOpen={() =>
                  onOpenIdentity({
                    id: candidate.identityId,
                    displayName: candidate.displayName,
                    photoCount: candidate.photoCount,
                    thumbnailUrl: candidate.thumbnailUrl,
                  })
                }
                onRename={(displayName) => onRename(candidate.identityId, displayName)}
              />
            ))}
          </motion.ul>
        )}
      </motion.div>
    </motion.div>
  );
}

function CandidateRow({
  candidate,
  onOpen,
  onRename,
}: {
  candidate: FaceMatchCandidate;
  onOpen: () => void;
  onRename: (displayName: string | null) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(candidate.displayName ?? "");
  // Matches the pgvector cosine-distance convention (`1 - similarity`) used
  // server-side, so this maps back to a 0-100 similarity for display.
  const matchPercent = Math.max(
    0,
    Math.min(100, Math.round((1 - candidate.distance) * 100)),
  );

  return (
    <motion.li
      variants={staggerItem}
      className="flex items-center gap-3 rounded-2xl border border-navy-800 bg-navy-950/40 p-2"
    >
      {candidate.thumbnailUrl && (
        <img
          src={resolveApiUrl(candidate.thumbnailUrl)}
          alt={t("photoDetail.detectedFace")}
          className="h-12 w-12 rounded-full object-cover"
        />
      )}
      <div className="flex flex-1 flex-col gap-0.5">
        <input
          type="text"
          value={name}
          placeholder={t("people.unnamedPlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onRename(name.trim() || null)}
          className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-mist-100 outline-none hover:border-navy-700 focus:border-blue-500"
        />
        <span className="px-1 text-xs text-mist-500">
          {t("identify.matchPercent", { percent: matchPercent })}
        </span>
      </div>
      <button type="button" onClick={onOpen} className={secondaryButton}>
        {t("identify.viewPhotos")}
      </button>
    </motion.li>
  );
}
