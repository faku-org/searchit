/**
 * Shared Tailwind class fragments for the navy/blue/ice brand theme (see the
 * `@theme` block in App.css for the underlying color tokens). Centralized
 * here rather than repeated per-component so the ~10 components that make up
 * the UI stay visually consistent and can be re-tuned in one place.
 */

export const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-navy-700 bg-navy-800/80 px-3 py-1.5 text-xs font-medium text-mist-300 transition-colors hover:border-navy-600 hover:text-mist-100 disabled:pointer-events-none disabled:opacity-50";

export const pillActive =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-navy-950";

export const primaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-full bg-blue-500 px-4 py-2 text-sm font-medium text-navy-950 transition-colors hover:bg-blue-400 disabled:pointer-events-none disabled:opacity-50";

export const secondaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-navy-700 bg-navy-800 px-4 py-2 text-sm font-medium text-mist-100 transition-colors hover:border-navy-600 disabled:pointer-events-none disabled:opacity-50";

export const inputClass =
  "rounded-full border border-navy-700 bg-navy-800 px-3.5 py-1.5 text-sm text-mist-100 outline-none transition-colors placeholder:text-mist-500 focus:border-blue-500";

export const fieldLabel = "text-[11px] font-medium text-mist-500";

export const card =
  "overflow-hidden rounded-2xl border border-navy-800 bg-navy-900";

export const modalBackdrop =
  "fixed inset-0 z-20 flex items-center justify-center bg-navy-950/70 p-6 backdrop-blur-sm";

export const modalPanel =
  "flex w-full flex-col gap-3 rounded-2xl border border-navy-800 bg-navy-900 p-5 shadow-2xl shadow-black/40";

export const iconButton =
  "inline-flex items-center justify-center rounded-full p-1.5 text-mist-400 transition-colors hover:bg-navy-800 hover:text-mist-100";

/** Spring used for the small, snappy micro-interactions throughout the app. */
export const springTransition = { type: "spring", stiffness: 400, damping: 32 } as const;

export const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
};

export const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: springTransition },
};
