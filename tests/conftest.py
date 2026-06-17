"""Shared test fixtures.

We synthesize a tiny image at runtime (a solid square on a flat background) so the
test suite needs no binary fixtures checked into the repo.
"""

import io

import pytest
from PIL import Image

# Tests import rembg directly (via importorskip), bypassing the lazy shim in
# bgremove.core. Run it here first so the native libs are preloaded before any
# test module imports rembg (needed on NixOS outside the Nix shell).
from bgremove.core import _ensure_native_libs

_ensure_native_libs()


@pytest.fixture
def sample_image_bytes() -> bytes:
    """A 96x96 white canvas with a red square in the middle, as PNG bytes."""
    img = Image.new("RGB", (96, 96), color=(255, 255, 255))
    for x in range(28, 68):
        for y in range(28, 68):
            img.putpixel((x, y), (220, 30, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
