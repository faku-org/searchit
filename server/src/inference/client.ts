import type {
  DetectFacesResponseBody,
  EmbedImageResponseBody,
  EmbedTextResponseBody,
  ReadSceneTextResponseBody,
} from "@searchit/shared";

export const INFERENCE_URL = process.env.INFERENCE_URL ?? "http://localhost:8000";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${INFERENCE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
): Promise<ReadSceneTextResponseBody> {
  return postImagePath<ReadSceneTextResponseBody>(
    "/read-scene-text",
    imagePath,
  );
}

export async function checkInferenceHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${INFERENCE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
