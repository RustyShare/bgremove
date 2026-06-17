"""Core background-removal engine.

This module is the single place that talks to ``rembg``. Both the CLI
(:mod:`bgremove.cli`) and the web app (:mod:`bgremove.web.app`) call into here so
the segmentation logic can never drift between the two frontends.

Output is always PNG with an alpha channel (RGBA): the background pixels are made
transparent, which requires an alpha-capable container format.
"""

from __future__ import annotations

from functools import lru_cache

# The default model is a good general-purpose choice. Alternatives:
#   - "u2netp"             : lighter/faster, slightly lower quality
#   - "isnet-general-use"  : sharper edges on many subjects
#   - "u2net_human_seg"    : tuned for people
#   - "silueta"            : small download, decent quality
DEFAULT_MODEL = "u2net"

SUPPORTED_MODELS = (
    "u2net",
    "u2netp",
    "u2net_human_seg",
    "isnet-general-use",
    "silueta",
)


@lru_cache(maxsize=4)
def _session(model: str):
    """Return a cached ``rembg`` session for ``model``.

    Building a session loads an ONNX model into memory and, on first use ever,
    downloads it (cached under ``~/.u2net/``). Both are expensive, so sessions are
    memoised per-model for the lifetime of the process.
    """
    # Imported lazily so that importing :mod:`bgremove` (e.g. for ``--help`` or
    # version checks) does not pay the cost of pulling in onnxruntime.
    from rembg import new_session

    return new_session(model)


def remove_background(
    image_bytes: bytes,
    *,
    model: str = DEFAULT_MODEL,
    alpha_matting: bool = False,
) -> bytes:
    """Remove the background from an image.

    Args:
        image_bytes: The raw bytes of the source image (JPEG, PNG, WebP, ...).
        model: Which segmentation model to use. See :data:`SUPPORTED_MODELS`.
        alpha_matting: Refine edges (helps with hair/fur) at the cost of speed.

    Returns:
        PNG bytes (RGBA) of the input with its background made transparent.
    """
    from rembg import remove

    return remove(
        image_bytes,
        session=_session(model),
        alpha_matting=alpha_matting,
    )


class BackgroundRemover:
    """Convenience wrapper that pins a model choice across many calls."""

    def __init__(self, model: str = DEFAULT_MODEL):
        self.model = model

    def process(self, image_bytes: bytes, *, alpha_matting: bool = False) -> bytes:
        """Remove the background using this instance's configured model."""
        return remove_background(
            image_bytes, model=self.model, alpha_matting=alpha_matting
        )

    def warm_up(self) -> None:
        """Eagerly build the model session (download + load) ahead of time."""
        _session(self.model)
