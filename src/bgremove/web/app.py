"""FastAPI web app: drag-and-drop background removal.

Exposes:
    GET  /              -> the single-page UI (static/index.html)
    POST /api/remove    -> multipart upload, returns the PNG cutout
    GET  /api/health    -> liveness probe

The service is stateless: uploaded images are processed in memory and never
written to disk.
"""

from __future__ import annotations

import asyncio
import io
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from ..core import (
    DEFAULT_BACKGROUND,
    DEFAULT_MODEL,
    SUPPORTED_BACKGROUNDS,
    SUPPORTED_MODELS,
    BackgroundRemover,
    remove_background,
)

logger = logging.getLogger("bgremove.web")


def _configure_logging() -> None:
    """Ensure the ``bgremove`` logs are emitted.

    uvicorn configures only its own loggers, not ours, so without this our
    ``bgremove.*`` log records would have no handler and never appear. Attach one
    handler to the package root logger and stop it propagating to avoid dupes.
    """
    root = logging.getLogger("bgremove")
    root.setLevel(logging.INFO)
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s")
        )
        root.addHandler(handler)
        root.propagate = False


_configure_logging()

# Reject obviously-too-large uploads early (the model is the real cost, but this
# protects against accidental huge files). 25 MB is generous for photos.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}

_STATIC_DIR = Path(__file__).parent / "static"


def _warm_default_model() -> None:
    """Download (if needed) and load the default model session."""
    try:
        BackgroundRemover(DEFAULT_MODEL).warm_up()
        logger.info("Default model '%s' is ready.", DEFAULT_MODEL)
    except Exception:  # never let warm-up crash the server
        logger.exception("Failed to warm up default model '%s'.", DEFAULT_MODEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the default model in the background so the first real request is fast,
    # without blocking startup (and without freezing the event loop).
    logger.info("Startup: scheduling background warm-up of default model %r.", DEFAULT_MODEL)
    asyncio.create_task(run_in_threadpool(_warm_default_model))
    yield


app = FastAPI(
    title="bgremove",
    description="Background removal web UI",
    lifespan=lifespan,
)


@app.middleware("http")
async def no_cache(request, call_next):
    # This is a local dev tool whose static assets are edited in place. Browser
    # caching of a stale index.html/app.js can desync the frontend (e.g. new JS
    # against old HTML) and silently break uploads, so always revalidate.
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "default_model": DEFAULT_MODEL}


@app.post("/api/remove")
async def remove_endpoint(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    alpha_matting: bool = Form(False),
    background: str = Form(DEFAULT_BACKGROUND),
):
    """Remove the background from an uploaded image and return PNG bytes."""
    logger.info(
        "POST /api/remove received: filename=%r content_type=%r model=%r "
        "alpha_matting=%s background=%r",
        file.filename,
        file.content_type,
        model,
        alpha_matting,
        background,
    )
    if model not in SUPPORTED_MODELS:
        logger.warning("Rejecting request: unknown model %r.", model)
        raise HTTPException(status_code=400, detail=f"Unknown model '{model}'.")
    if background not in SUPPORTED_BACKGROUNDS:
        logger.warning("Rejecting request: unknown background %r.", background)
        raise HTTPException(
            status_code=400, detail=f"Unknown background '{background}'."
        )
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        logger.warning("Rejecting request: unsupported type %r.", file.content_type)
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported type '{file.content_type}'. "
            f"Allowed: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}.",
        )

    logger.info("Reading upload body ...")
    data = await file.read()
    logger.info("Read %d bytes from upload.", len(data))
    if not data:
        logger.warning("Rejecting request: empty upload.")
        raise HTTPException(status_code=400, detail="Empty upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        logger.warning("Rejecting request: %d bytes exceeds limit.", len(data))
        raise HTTPException(status_code=413, detail="Image too large (max 25 MB).")

    # The model download + inference is blocking and CPU-bound. Run it in a
    # threadpool so a slow first-time model download never freezes the event
    # loop (which would wedge the UI and every other request).
    logger.info("Dispatching to model worker thread ...")
    try:
        result = await run_in_threadpool(
            remove_background,
            data,
            model=model,
            alpha_matting=alpha_matting,
            background=background,
        )
    except Exception as exc:  # surface a clean error to the client
        logger.exception("Processing failed for model %r.", model)
        raise HTTPException(status_code=422, detail=f"Could not process image: {exc}")

    logger.info("Returning %d-byte PNG to client.", len(result))
    return StreamingResponse(
        io.BytesIO(result),
        media_type="image/png",
        headers={"Content-Disposition": 'inline; filename="cutout.png"'},
    )


# Mount the SPA at the root. html=True makes "/" serve index.html.
app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")


def main() -> None:
    """Console-script entry point: run the dev server with uvicorn."""
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
