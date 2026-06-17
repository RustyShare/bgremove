# Design Document — bgremove

## 1. Problem & goals

Build an application that removes the background from a picture, keeping only the main
subject (a person, product, animal, object, …) and producing a cutout with a transparent
background.

**Goals**

- Good out-of-the-box quality on common subjects, with no manual masking.
- Two ways to use it: an interactive **web UI** and a scriptable **CLI**.
- **Local & private**: processing runs on the user's machine; no cloud, no API keys, no
  per-image cost, works offline after the first model download.
- Easy to install and to extend.

**Non-goals (for v0.1)**

- Manual refinement / brush tools, background *replacement* (compositing onto a new
  background), user accounts, or persistent storage. These are noted as future work.

## 2. Approach

Image background removal is a **salient-object segmentation** problem. Rather than train
or hand-roll a model, we stand on [`rembg`](https://github.com/danielgatis/rembg): a
mature, MIT-licensed library that wraps pretrained ONNX models (U2Net, ISNet, …) and runs
them on `onnxruntime`. It is CPU-friendly, has an optional GPU path, and produces a
ready-to-use RGBA result. This gives strong quality with minimal code and no ML
infrastructure to maintain.

**Output is always PNG (RGBA).** Transparency requires an alpha-capable container, so JPEG
output is intentionally not offered.

## 3. Architecture

```
                 ┌──────────────────────────┐
   CLI  ───────► │                          │
 (Typer)         │   bgremove.core          │ ──► rembg ──► onnxruntime ──► ONNX model
                 │   remove_background()    │                              (~/.u2net cache)
   Web  ───────► │   BackgroundRemover      │
 (FastAPI+SPA)   └──────────────────────────┘
```

The **core** module (`src/bgremove/core.py`) is the *single* place that talks to `rembg`.
Both frontends call `remove_background(...)`, so segmentation behavior can never drift
between CLI and web. Model sessions are expensive to build (load + first-time download),
so they are memoised per-model with `functools.lru_cache`. `rembg`/`onnxruntime` are
imported lazily inside the functions, keeping `import bgremove` (e.g. for `--help`) cheap.

### CLI (`cli.py`, [Typer](https://typer.tiangolo.com/))

- `bgremove run INPUT [OUTPUT]` — one image; output defaults to `<input>.out.png`.
- `bgremove batch INPUT_DIR OUTPUT_DIR` — every image in a folder; continues past a single
  bad file and reports a summary + non-zero exit on failures.
- Flags: `--model`, `--alpha-matting`. Output coerced to `.png`.

### Web (`web/app.py`, [FastAPI](https://fastapi.tiangolo.com/))

- `POST /api/remove` — multipart upload + optional `model`/`alpha_matting`; returns the PNG
  as a streaming response. **Stateless**: bytes are processed in memory, nothing is written
  to disk.
- Guardrails: content-type allowlist (jpeg/png/webp/bmp), 25 MB size cap, model-name
  validation → clean HTTP errors (`413`/`415`/`400`/`422`).
- `GET /` serves a dependency-free SPA (`web/static/`): drag-and-drop / click / clipboard
  paste, before-after preview over a CSS checkerboard, and a download button. A loading
  overlay covers the request and warns about the one-time model download.

## 4. Key decisions & trade-offs

| Decision | Why | Trade-off / alternative |
| --- | --- | --- |
| `rembg` (local ONNX) | Mature, MIT, good quality, CPU-friendly, offline, free | Larger install + one-time ~170 MB model download. Alt: cloud API (better quality, but cost + privacy) or in-browser WASM (zero backend, but heavier client). |
| Shared core, two frontends | Prevents logic drift; one place to test/extend | Slightly more structure than a single script. |
| PNG-only output | Transparency needs an alpha channel | No JPEG output (acceptable; that's the point). |
| Lazy + cached model session | Fast CLI startup; pay model cost once | First image per process is slow. |
| Python end-to-end | `rembg` is Python; one language for CLI + web | A JS client could do in-browser inference, but splits the stack. |
| Stateless web service | Privacy + trivial to scale horizontally | No history/gallery (out of scope for v0.1). |

## 5. Data flow (web)

1. Browser sends `multipart/form-data` (`file`, `model`, `alpha_matting`) to `/api/remove`.
2. FastAPI validates type/size/model, reads bytes into memory.
3. `core.remove_background()` runs the cached `rembg` session → RGBA PNG bytes.
4. Bytes streamed back as `image/png`; the SPA renders the result on a checkerboard and
   wires up the download link. Object URLs are revoked to avoid memory leaks.

## 6. Testing

- `tests/conftest.py` synthesizes a small image at runtime (subject on a flat background)
  — no binary fixtures in the repo.
- `test_core.py`: output is a valid **RGBA PNG** whose alpha channel has both fully
  transparent and opaque pixels (i.e. it really cut something out).
- `test_web.py`: `/api/health`, `/` serves the UI, `/api/remove` returns PNG bytes, and the
  validation paths (bad model → 400, non-image → 415).
- Tests `importorskip("rembg")` so they skip cleanly without the heavy dependency.

## 7. Operational notes

- **First-run download**: ~170 MB per model into `~/.u2net/`; needs network once.
- **Performance**: CPU inference is a few seconds per image depending on size/model;
  `pip install -e ".[gpu]"` switches to the CUDA runtime.
- **Deployment**: run uvicorn with multiple workers behind a reverse proxy; the service is
  stateless so it scales horizontally.

## 8. Future work

- Background **replacement** (composite the cutout onto a solid color or a chosen image).
- Manual mask touch-up (brush add/remove).
- Drag-to-process **multiple files** in the web UI; ZIP download for batches.
- Expose `alpha_matting` fine-tuning (foreground/background thresholds, erosion).
- Containerization (`Dockerfile`) with the model pre-baked to skip first-run download.
- Optional auth + rate limiting for a public deployment.
