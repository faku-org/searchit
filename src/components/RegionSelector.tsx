import { useRef, useState } from "react";
import type { BoundingBox, SelectRegionAction } from "@searchit/shared";
import { useTranslation } from "../lib/i18n";

interface RegionSelectorProps {
  src: string;
  alt: string;
  onSelect: (bbox: BoundingBox, action: SelectRegionAction) => void;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MIN_SELECTION_PX = 8;

export function RegionSelector({ src, alt, onSelect }: RegionSelectorProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [committedRect, setCommittedRect] = useState<DragState | null>(null);

  /** The actual visible image rect within its box, accounting for object-contain letterboxing. */
  function getImageRect(): Rect | null {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth || !img.naturalHeight) {
      return null;
    }

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const naturalRatio = img.naturalWidth / img.naturalHeight;
    const containerRatio = containerWidth / containerHeight;

    if (naturalRatio > containerRatio) {
      const width = containerWidth;
      const height = width / naturalRatio;
      return { left: 0, top: (containerHeight - height) / 2, width, height };
    }
    const height = containerHeight;
    const width = height * naturalRatio;
    return { left: (containerWidth - width) / 2, top: 0, width, height };
  }

  function getRelativePos(
    event: React.MouseEvent,
  ): { x: number; y: number } | null {
    const container = containerRef.current;
    const imageRect = getImageRect();
    if (!container || !imageRect) return null;

    const containerRect = container.getBoundingClientRect();
    const rawX = event.clientX - containerRect.left;
    const rawY = event.clientY - containerRect.top;

    return {
      x: Math.min(
        Math.max(rawX, imageRect.left),
        imageRect.left + imageRect.width,
      ),
      y: Math.min(
        Math.max(rawY, imageRect.top),
        imageRect.top + imageRect.height,
      ),
    };
  }

  function rectFromDrag(d: DragState): Rect {
    return {
      left: Math.min(d.startX, d.currentX),
      top: Math.min(d.startY, d.currentY),
      width: Math.abs(d.currentX - d.startX),
      height: Math.abs(d.currentY - d.startY),
    };
  }

  function toImageBbox(d: DragState): BoundingBox | null {
    const img = imgRef.current;
    const imageRect = getImageRect();
    if (!img || !imageRect) return null;

    const displayed = rectFromDrag(d);
    const scaleX = img.naturalWidth / imageRect.width;
    const scaleY = img.naturalHeight / imageRect.height;

    return {
      x: Math.round((displayed.left - imageRect.left) * scaleX),
      y: Math.round((displayed.top - imageRect.top) * scaleY),
      width: Math.round(displayed.width * scaleX),
      height: Math.round(displayed.height * scaleY),
    };
  }

  function handleMouseDown(event: React.MouseEvent) {
    if (committedRect) {
      setCommittedRect(null);
      return;
    }
    const pos = getRelativePos(event);
    if (!pos) return;
    setDrag({ startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y });
  }

  function handleMouseMove(event: React.MouseEvent) {
    if (!drag) return;
    const pos = getRelativePos(event);
    if (!pos) return;
    setDrag({ ...drag, currentX: pos.x, currentY: pos.y });
  }

  function handleMouseUp() {
    if (!drag) return;
    const rect = rectFromDrag(drag);
    if (rect.width < MIN_SELECTION_PX || rect.height < MIN_SELECTION_PX) {
      setDrag(null);
      return;
    }
    setCommittedRect(drag);
    setDrag(null);
  }

  function handleAction(action: SelectRegionAction) {
    if (!committedRect) return;
    const bbox = toImageBbox(committedRect);
    setCommittedRect(null);
    if (bbox) onSelect(bbox, action);
  }

  const activeDrag = drag ?? committedRect;
  const displayRect = activeDrag ? rectFromDrag(activeDrag) : null;

  return (
    <div
      ref={containerRef}
      className="relative inline-block select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="block max-h-[60vh] w-full rounded object-contain"
      />

      {displayRect && (
        <div
          className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/10"
          style={{
            left: displayRect.left,
            top: displayRect.top,
            width: displayRect.width,
            height: displayRect.height,
          }}
        />
      )}

      {committedRect && displayRect && (
        <div
          className="absolute z-10 flex gap-1 rounded-md bg-neutral-900 p-1 text-xs shadow-lg"
          style={{
            left: displayRect.left,
            top: displayRect.top + displayRect.height + 4,
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => handleAction("similar")}
            className="rounded px-2 py-1 text-white hover:bg-neutral-700"
          >
            {t("region.findSimilar")}
          </button>
          <button
            type="button"
            onClick={() => handleAction("face")}
            className="rounded px-2 py-1 text-white hover:bg-neutral-700"
          >
            {t("region.linkAsPerson")}
          </button>
          <button
            type="button"
            onClick={() => setCommittedRect(null)}
            className="rounded px-2 py-1 text-neutral-400 hover:bg-neutral-700"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
