Fixtures used by `scripts/smoke-test-sidecars.mjs` to exercise real inference
endpoints in CI (see `.github/workflows/release.yml`'s `smoke-test` job).

- `test-face.jpg` — the standard "Lena" CV test image, copied from OpenCV's own
  `samples/data/lena.jpg` (BSD-3-Clause). Used to sanity-check real face
  detection returns a plausible result.
- `test-text.jpg`, `test-red.jpg`, `test-blue.jpg` — generated locally with
  Pillow, used to sanity-check OCR text recognition and CLIP semantic ranking.
