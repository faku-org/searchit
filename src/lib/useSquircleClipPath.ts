import { useLayoutEffect, useRef, useState } from "react";
import { getSvgPath } from "figma-squircle";

interface UseSquircleClipPathOptions {
  cornerRadius: number;
  cornerSmoothing: number;
}

/**
 * Figma's "corner smoothing" produces a continuous-curvature squircle whose
 * radius is a fixed pixel value, unlike a CSS `clip-path: url(#id)` mapped
 * via objectBoundingBox (which stretches the same relative curve to fit
 * whatever box it's applied to). Measuring the element's real rendered size
 * and recomputing the path on resize is what keeps the corner radius exact
 * across this app's fluid, responsive grid.
 */
export function useSquircleClipPath<T extends HTMLElement>({
  cornerRadius,
  cornerSmoothing,
}: UseSquircleClipPathOptions) {
  const ref = useRef<T>(null);
  const [clipPath, setClipPath] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updatePath = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      const path = getSvgPath({ width, height, cornerRadius, cornerSmoothing });
      setClipPath(`path('${path}')`);
    };

    updatePath();
    const observer = new ResizeObserver(updatePath);
    observer.observe(element);
    return () => observer.disconnect();
  }, [cornerRadius, cornerSmoothing]);

  return { ref, clipPath };
}
