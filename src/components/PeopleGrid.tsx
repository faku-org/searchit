import { useState } from "react";
import { UserRound } from "lucide-react";
import { motion } from "motion/react";
import type { IdentitySummary } from "@searchit/shared";
import { resolveApiUrl } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { staggerContainer, staggerItem } from "../lib/theme";

interface PeopleGridProps {
  identities: IdentitySummary[];
  onSelect: (identity: IdentitySummary) => void;
  onRename: (id: string, displayName: string | null) => void;
}

export function PeopleGrid({ identities, onSelect, onRename }: PeopleGridProps) {
  const { t } = useTranslation();

  if (identities.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-mist-500">
        {t("people.empty")}
      </div>
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className="grid flex-1 mb-5 -mt-5 content-start grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 overflow-y-auto p-8"
    >
      {identities.map((identity) => (
        <IdentityCard
          key={identity.id}
          identity={identity}
          onSelect={() => onSelect(identity)}
          onRename={(displayName) => onRename(identity.id, displayName)}
        />
      ))}
    </motion.div>
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
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -4 }}
      className="group relative flex aspect-4/5 mt-20 mb-35 flex-col overflow-hidden rounded-2xl border border-navy-800 bg-navy-900"
    >
      <button type="button" onClick={onSelect} className="absolute inset-0">
        {identity.thumbnailUrl ? (
          <img
            src={resolveApiUrl(identity.thumbnailUrl)}
            alt={identity.displayName ?? t("people.unnamedPerson")}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-mist-500">
            <UserRound className="h-10 w-10" />
          </div>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-navy-950/95 via-navy-950/40 to-transparent" />
      <div className="relative mt-auto flex flex-col gap-0.5 p-3">
        <input
          type="text"
          value={name}
          placeholder={t("people.unnamedPlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => onRename(name.trim() || null)}
          className="truncate rounded border border-transparent bg-transparent px-0.5 font-serif text-base font-semibold text-mist-100 outline-none hover:border-navy-700 focus:border-blue-500"
        />
        <span className="px-0.5 text-xs text-mist-300">
          {identity.photoCount} {t("people.photoWord")}
          {identity.photoCount === 1 ? "" : "s"}
        </span>
      </div>
    </motion.div>
  );
}
