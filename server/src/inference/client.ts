import type {
  DetectFacesResponseBody,
  EmbedImageResponseBody,
  EmbedTextResponseBody,
  ReadSceneTextResponseBody,
} from "@searchit/shared";

export const INFERENCE_URL = process.env.INFERENCE_URL ?? "http://localhost:8000";
// Without a timeout, a hung or crashed inference call holds its worker slot
// (see queue.ts's enqueue) forever, wedging the whole ingest pipeline behind
// it. Model inference on CPU fallback can legitimately take tens of seconds,
// so this is generous rather than tight.
const INFERENCE_TIMEOUT_MS = Number(process.env.INFERENCE_TIMEOUT_MS ?? 120_000);

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${INFERENCE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Inference service returned ${response.status}: ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

function postImagePath<T>(path: string, imagePath: string): Promise<T> {
  return postJson<T>(path, { imagePath });
}

export function detectFaces(
  imagePath: string,
): Promise<DetectFacesResponseBody> {
  return postImagePath<DetectFacesResponseBody>("/detect-faces", imagePath);
}

export function embedImage(
  imagePath: string,
): Promise<EmbedImageResponseBody> {
  return postImagePath<EmbedImageResponseBody>("/embed-image", imagePath);
}

export function embedText(text: string): Promise<EmbedTextResponseBody> {
  return postJson<EmbedTextResponseBody>("/embed-text", { text });
}

export function readSceneText(
  imagePath: string,
  minConfidence?: number,
): Promise<ReadSceneTextResponseBody> {
  return postJson<ReadSceneTextResponseBody>("/read-scene-text", {
    imagePath,
    minConfidence,
  });
}

export async function checkInferenceHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${INFERENCE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

interface OcrStatus {
  ocrActiveBackend: "cuda" | "mps" | null;
  ocrHardwareCapable: boolean;
  ocrModelLoaded: boolean;
}

/**
 * Reads the OCR tier fields off the inference sidecar's own `/health` (see
 * inference/app.py) -- lets the Developer tab show whether DeepSeek-OCR-2 is
 * actually in effect right now, distinct from the "high-quality OCR" setting
 * just being turned on (which only unlocks the option, see
 * src-tauri/src/lib.rs's `high_quality_ocr_enabled` doc comment).
 */
export async function getOcrStatus(): Promise<OcrStatus> {
  try {
    const response = await fetch(`${INFERENCE_URL}/health`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as {
      ocrActiveBackend?: "cuda" | "mps" | null;
      ocrModelLoaded?: boolean;
      ocrCapability?: { cuda?: boolean; mps?: boolean };
    };
    return {
      ocrActiveBackend: body.ocrActiveBackend ?? null,
      ocrHardwareCapable: Boolean(
        body.ocrCapability?.cuda || body.ocrCapability?.mps,
      ),
      ocrModelLoaded: body.ocrModelLoaded ?? false,
    };
  } catch {
    return { ocrActiveBackend: null, ocrHardwareCapable: false, ocrModelLoaded: false };
  }
}
