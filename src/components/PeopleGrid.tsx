import { useState } from "react";
import type { IdentitySummary } from "@searchit/shared";
import { resolveApiUrl } from "../lib/api";
import { useTranslation } from "../lib/i18n";

interface PeopleGridProps {
  identities: IdentitySummary[];
  onSelect: (identity: IdentitySummary) => void;
  onRename: (id: string, displayName: string | null) => void;
}

export function PeopleGrid({ identities, onSelect, onRename }: PeopleGridProps) {
  const { t } = useTranslation();

  if (identities.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
        {t("people.empty")}
      </div>
    );
  }

  return (
    <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 overflow-y-auto p-4 content-start">
      {identities.map((identity) => (
        <IdentityCard
          key={identity.id}
          identity={identity}
          onSelect={() => onSelect(identity)}
          onRename={(displayName) => onRename(identity.id, displayName)}
        />
      ))}
    </div>
  );
}

function IdentityCard({
  identity,
  onSelect,
  onRename,
}: {
  identity: IdentitySummary;
  onSelect: () => void;
  onRename: (displayName: string | null) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(identity.displayName ?? "");

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <button
        type="button"
        onClick={onSelect}
        className="aspect-square w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800"
      >
        {identity.thumbnailUrl && (
          <img
            src={resolveApiUrl(identity.thumbnailUrl)}
            alt={identity.displayName ?? t("people.unnamedPerson")}
            className="h-full w-full object-cover"
          />
        )}
      </button>
      <div className="flex flex-col gap-1 p-2">
        <input
          type="text"
          value={name}
          placeholder={t("people.unnamedPlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onRename(name.trim() || null)}
          className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium text-neutral-900 hover:border-neutral-300 focus:border-neutral-400 dark:text-neutral-100 dark:hover:border-neutral-700"
        />
        <span className="px-1 text-[10px] text-neutral-500 dark:text-neutral-400">
          {identity.photoCount} {t("people.photoWord")}
          {identity.photoCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
