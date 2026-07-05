import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "../lib/i18n";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const syncMaximized = () => {
      appWindow
        .isMaximized()
        .then((maximized) => {
          if (!cancelled) setIsMaximized(maximized);
        })
        .catch(() => {});
    };
    syncMaximized();
    const unlistenPromise = appWindow.onResized(syncMaximized);
    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      className="flex h-8 shrink-0 select-none items-center justify-between bg-navy-950"
    >
      <span
        data-tauri-drag-region
        className="pl-3 font-serif text-xs font-medium text-mist-300"
      >
        SearchIt
      </span>
      <div className="flex h-full">
        <TitleBarButton
          label={t("titlebar.minimize")}
          onClick={() => void appWindow.minimize()}
        >
          <Minus className="h-3.5 w-3.5" />
        </TitleBarButton>
        <TitleBarButton
          label={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
          onClick={() => void appWindow.toggleMaximize()}
        >
          {isMaximized ? (
            <Copy className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </TitleBarButton>
        <TitleBarButton
          label={t("titlebar.close")}
          onClick={() => void appWindow.close()}
          danger
        >
          <X className="h-3.5 w-3.5" />
        </TitleBarButton>
      </div>
    </div>
  );
}

function TitleBarButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-full w-11 items-center justify-center text-mist-400 transition-colors ${
        danger ? "hover:bg-rose-600 hover:text-mist-100" : "hover:bg-navy-800 hover:text-mist-100"
      }`}
    >
      {children}
    </button>
  );
}
