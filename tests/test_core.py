"""Tests for the core engine.

These exercise the real rembg model, so the first run downloads it (~170 MB) and
they are comparatively slow. They are skipped automatically if rembg/onnxruntime
is not installed.
"""

import io

import pytest
from PIL import Image

rembg = pytest.importorskip("rembg")

from bgremove import remove_background


def test_returns_rgba_png_with_alpha(sample_image_bytes):
    out = remove_background(sample_image_bytes)

    img = Image.open(io.BytesIO(out))
    assert img.format == "PNG"
    assert img.mode == "RGBA"

    # The cutout must actually carry transparency: some pixels fully transparent
    # (removed background) and some fully opaque (kept subject).
    alpha = img.getchannel("A")
    extrema = alpha.getextrema()  # (min, max)
    assert extrema[0] == 0, "expected some fully transparent background pixels"
    assert extrema[1] > 0, "expected some opaque subject pixels"


@pytest.mark.parametrize(
    "background, corner",
    [("white", (255, 255, 255)), ("black", (0, 0, 0))],
)
def test_solid_background_is_opaque_rgb(sample_image_bytes, background, corner):
    out = remove_background(sample_image_bytes, background=background)

    img = Image.open(io.BytesIO(out))
    assert img.format == "PNG"
    assert img.mode == "RGB", "solid background should drop the alpha channel"
    # The removed-background area (a corner) must be filled with the chosen color.
    assert img.getpixel((0, 0)) == corner
