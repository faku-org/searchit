import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import type { Tab } from "../App";
import { useTranslation, type TranslationKey } from "../lib/i18n";
import { markOnboardingTourSeen } from "../lib/onboarding";

interface TourStep {
  target?: string;
  tab?: Tab;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}

const STEPS: TourStep[] = [
  { titleKey: "onboarding.welcome.title", bodyKey: "onboarding.welcome.body" },
  {
    target: "nav-tabs",
    tab: "photos",
    titleKey: "onboarding.navTabs.title",
    bodyKey: "onboarding.navTabs.body",
  },
  {
    target: "search-filters",
    tab: "photos",
    titleKey: "onboarding.searchFilters.title",
    bodyKey: "onboarding.searchFilters.body",
  },
  {
    target: "results-grid",
    tab: "photos",
    titleKey: "onboarding.resultsGrid.title",
    bodyKey: "onboarding.resultsGrid.body",
  },
  {
    target: "people-grid",
    tab: "people",
    titleKey: "onboarding.peopleGrid.title",
    bodyKey: "onboarding.peopleGrid.body",
  },
  {
    target: "identify-by-photo",
    tab: "people",
    titleKey: "onboarding.identifyByPhoto.title",
    bodyKey: "onboarding.identifyByPhoto.body",
  },
  {
    target: "map-view",
    tab: "map",
    titleKey: "onboarding.mapView.title",
    bodyKey: "onboarding.mapView.body",
  },
  {
    target: "tag-location-btn",
    tab: "map",
    titleKey: "onboarding.tagLocation.title",
    bodyKey: "onboarding.tagLocation.body",
  },
  {
    target: "new-event-btn",
    titleKey: "onboarding.newEvent.title",
    bodyKey: "onboarding.newEvent.body",
  },
  {
    target: "watch-dir-row",
    titleKey: "onboarding.watchDir.title",
    bodyKey: "onboarding.watchDir.body",
  },
  {
    target: "lang-toggle",
    titleKey: "onboarding.langToggle.title",
    bodyKey: "onboarding.langToggle.body",
  },
];

interface OnboardingTourProps {
  activeTab: Tab;
  onChangeTab: (tab: Tab) => void;
  onClose: () => void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PADDING = 8;
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT_ESTIMATE = 180;
const GAP = 12;

const centeredTooltipStyle: CSSProperties = {
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
};

function tooltipStyleForRect(rect: TargetRect): CSSProperties {
  const spaceBelow = window.innerHeight - (rect.top + rect.height);
  const placeBelow = spaceBelow >= TOOLTIP_HEIGHT_ESTIMATE || spaceBelow >= rect.top;
  const top = placeBelow
    ? rect.top + rect.height + GAP
    : Math.max(GAP, rect.top - GAP - TOOLTIP_HEIGHT_ESTIMATE);
  const left = Math.min(
    Math.max(GAP, rect.left),
    window.innerWidth - TOOLTIP_WIDTH - GAP,
  );
  return { top, left };
}

export function OnboardingTour({
  activeTab,
  onChangeTab,
  onClose,
}: OnboardingTourProps) {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const step = STEPS[stepIndex];
  const isOnRequiredTab = !step.tab || step.tab === activeTab;

  // Steps on another tab (People/Map) switch there automatically; the rect
  // effect below waits until `activeTab` catches up before measuring.
  useEffect(() => {
    if (!isOnRequiredTab && step.tab) onChangeTab(step.tab);
  }, [step, isOnRequiredTab, onChangeTab]);

  useLayoutEffect(() => {
    if (!isOnRequiredTab) {
      setRect(null);
      return;
    }
    function measure() {
      if (!step.target) {
        setRect(null);
        return;
      }
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const box = el.getBoundingClientRect();
      setRect({
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, isOnRequiredTab]);

  function finish() {
    markOnboardingTourSeen();
    onClose();
  }

  function handleNext() {
    if (stepIndex === STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((current) => current + 1);
  }

  function handleBack() {
    setStepIndex((current) => Math.max(0, current - 1));
  }

  return (
    <div className="fixed inset-0 z-[2000]" onClick={finish}>
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-lg transition-all duration-200"
          style={{
            top: rect.top - SPOTLIGHT_PADDING,
            left: rect.left - SPOTLIGHT_PADDING,
            width: rect.width + SPOTLIGHT_PADDING * 2,
            height: rect.height + SPOTLIGHT_PADDING * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-black/60" />
      )}
      <div
        className="pointer-events-auto fixed flex flex-col gap-3 rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-900"
        style={{
          width: TOOLTIP_WIDTH,
          ...(rect ? tooltipStyleForRect(rect) : centeredTooltipStyle),
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
          {t("onboarding.progress", {
            current: stepIndex + 1,
            total: STEPS.length,
          })}
        </span>
        <h2 className="text-sm font-semibold">{t(step.titleKey)}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {t(step.bodyKey)}
        </p>
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-neutral-500 underline hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            {t("onboarding.skip")}
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
              >
                {t("onboarding.back")}
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              {stepIndex === STEPS.length - 1
                ? t("onboarding.finish")
                : t("onboarding.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
