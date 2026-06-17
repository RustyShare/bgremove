"""Core background-removal engine.

This module is the single place that talks to ``rembg``. Both the CLI
(:mod:`bgremove.cli`) and the web app (:mod:`bgremove.web.app`) call into here so
the segmentation logic can never drift between the two frontends.

Output is always PNG with an alpha channel (RGBA): the background pixels are made
transparent, which requires an alpha-capable container format.
"""

from __future__ import annotations

import ctypes
import glob
import logging
import os
import sys
import time
from functools import lru_cache

logger = logging.getLogger("bgremove.core")

_native_libs_ready = False


def _ensure_native_libs() -> None:
    """Make the pip wheels' native dependencies loadable before importing them.

    On NixOS, the binary wheels we depend on (numpy, onnxruntime via ``rembg``)
    dynamically link against ``libstdc++``/``libgomp``/``libgcc_s``, which are not
    on the default loader path. If the process was not started inside the Nix
    shell (which sets ``LD_LIBRARY_PATH``), importing them fails with
    "Importing the numpy C-extensions failed" / "libstdc++.so.6: cannot open
    shared object file" — and the model never even downloads.

    This best-effort shim finds a gcc lib in ``/nix/store`` and preloads the
    libraries with ``RTLD_GLOBAL`` so the subsequent wheel imports resolve their
    symbols. It is a no-op on non-NixOS systems and when the libs are already
    available (e.g. inside the Nix shell). The loader path itself can't be
    changed after startup, but preloading achieves the same effect.
    """
    global _native_libs_ready
    if _native_libs_ready or sys.platform != "linux":
        return

    # If libstdc++ already loads, the environment is fine — nothing to do.
    try:
        ctypes.CDLL("libstdc++.so.6", mode=ctypes.RTLD_GLOBAL)
        _native_libs_ready = True
        return
    except OSError:
        pass

    needed = ("libstdc++.so.6", "libgcc_s.so.1", "libgomp.so.1")
    for libdir in sorted(glob.glob("/nix/store/*-gcc-*-lib/lib"), reverse=True):
        if not os.path.exists(os.path.join(libdir, "libstdc++.so.6")):
            continue
        for lib in needed:
            path = os.path.join(libdir, lib)
            if os.path.exists(path):
                try:
                    ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass
        _native_libs_ready = True
        return

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
    _ensure_native_libs()
    logger.info("Importing rembg / onnxruntime for model %r ...", model)
    from rembg import new_session

    model_home = os.environ.get("U2NET_HOME", os.path.expanduser("~/.u2net"))
    model_path = os.path.join(model_home, f"{model}.onnx")
    if os.path.exists(model_path):
        logger.info("Model %r already cached at %s; loading session.", model, model_path)
    else:
        logger.info(
            "Model %r NOT cached — rembg will download it to %s (this can take a "
            "while for ~170 MB models).",
            model,
            model_path,
        )

    started = time.monotonic()
    session = new_session(model)
    logger.info(
        "Model %r session ready in %.1fs.", model, time.monotonic() - started
    )
    return session


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
    _ensure_native_libs()
    logger.info(
        "remove_background: model=%r, input=%d bytes, alpha_matting=%s",
        model,
        len(image_bytes),
        alpha_matting,
    )
    from rembg import remove

    session = _session(model)
    logger.info("Running inference with model %r ...", model)
    started = time.monotonic()
    result = remove(image_bytes, session=session, alpha_matting=alpha_matting)
    logger.info(
        "remove_background: produced %d bytes in %.1fs.",
        len(result),
        time.monotonic() - started,
    )
    return result


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
