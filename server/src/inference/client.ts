import type {
  DetectFacesResponseBody,
  EmbedImageResponseBody,
  EmbedTextResponseBody,
  ReadSceneTextResponseBody,
} from "@searchit/shared";

const INFERENCE_URL = process.env.INFERENCE_URL ?? "http://localhost:8000";
// Without a timeout, a hung or crashed inference call holds its
// withWorkerSlot() slot forever, wedging the whole ingest pipeline behind it.
// Model inference on CPU fallback can legitimately take tens of seconds, so
// this is generous rather than tight.
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
