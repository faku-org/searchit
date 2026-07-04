import { useRef, useState } from "react";
import type { FaceMatchCandidate, IdentitySummary } from "@searchit/shared";
import { matchFace, resolveApiUrl } from "../lib/api";
import { useTranslation } from "../lib/i18n";

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
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-lg bg-white p-4 dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("identify.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {t("common.close")}
          </button>
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("identify.prompt")}
        </p>

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
              className="h-16 w-16 rounded object-cover"
            />
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
          >
            {filePreviewUrl
              ? t("identify.anotherFile")
              : t("identify.chooseFile")}
          </button>
        </div>

        {isMatching && (
          <p className="text-sm text-neutral-500">{t("identify.matching")}</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {candidates && candidates.length === 0 && !error && (
          <p className="text-sm text-neutral-500">
            {t("identify.noCandidates")}
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <ul className="flex flex-col gap-2">
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
                onRename={(displayName) =>
                  onRename(candidate.identityId, displayName)
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
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
    <li className="flex items-center gap-3 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      {candidate.thumbnailUrl && (
        <img
          src={resolveApiUrl(candidate.thumbnailUrl)}
          alt={t("photoDetail.detectedFace")}
          className="h-12 w-12 rounded object-cover"
        />
      )}
      <div className="flex flex-1 flex-col gap-1">
        <input
          type="text"
          value={name}
          placeholder={t("people.unnamedPlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onRename(name.trim() || null)}
          className="rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-neutral-900 hover:border-neutral-300 focus:border-neutral-400 dark:text-neutral-100 dark:hover:border-neutral-700"
        />
        <span className="px-1 text-xs text-neutral-500 dark:text-neutral-400">
          {t("identify.matchPercent", { percent: matchPercent })}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
      >
        {t("identify.viewPhotos")}
      </button>
    </li>
  );
}
