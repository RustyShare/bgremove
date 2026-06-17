"""FastAPI web app: drag-and-drop background removal.

Exposes:
    GET  /              -> the single-page UI (static/index.html)
    POST /api/remove    -> multipart upload, returns the PNG cutout
    GET  /api/health    -> liveness probe

The service is stateless: uploaded images are processed in memory and never
written to disk.
"""

from __future__ import annotations

import io
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from ..core import DEFAULT_MODEL, SUPPORTED_MODELS, remove_background

# Reject obviously-too-large uploads early (the model is the real cost, but this
# protects against accidental huge files). 25 MB is generous for photos.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp"}

_STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="bgremove", description="Background removal web UI")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "default_model": DEFAULT_MODEL}


@app.post("/api/remove")
async def remove_endpoint(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    alpha_matting: bool = Form(False),
):
    """Remove the background from an uploaded image and return PNG bytes."""
    if model not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model '{model}'.")
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported type '{file.content_type}'. "
            f"Allowed: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}.",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 25 MB).")

    try:
        result = remove_background(data, model=model, alpha_matting=alpha_matting)
    except Exception as exc:  # surface a clean error to the client
        raise HTTPException(status_code=422, detail=f"Could not process image: {exc}")

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
