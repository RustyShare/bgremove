"""bgremove — remove the background from a picture, keeping the main subject.

Public API:
    remove_background(image_bytes, *, model="u2net", alpha_matting=False) -> bytes
    BackgroundRemover(model="u2net").process(image_bytes) -> bytes
"""

from .core import (
    DEFAULT_MODEL,
    SUPPORTED_MODELS,
    BackgroundRemover,
    remove_background,
)

__all__ = [
    "remove_background",
    "BackgroundRemover",
    "DEFAULT_MODEL",
    "SUPPORTED_MODELS",
]

__version__ = "0.1.0"
