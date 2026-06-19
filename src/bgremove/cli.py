"""Command-line interface for bgremove.

Usage:
    bgremove run INPUT [OUTPUT] [--model M] [--alpha-matting]
    bgremove batch INPUT_DIR OUTPUT_DIR [--model M] [--alpha-matting]
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from .core import (
    DEFAULT_BACKGROUND,
    DEFAULT_MODEL,
    SUPPORTED_BACKGROUNDS,
    SUPPORTED_MODELS,
    remove_background,
)

app = typer.Typer(
    add_completion=False,
    help="Remove the background from a picture, keeping only the main subject.",
)

# Extensions rembg/Pillow can decode. Output is always written as .png.
_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}

_MODEL_HELP = f"Segmentation model. One of: {', '.join(SUPPORTED_MODELS)}."
_BG_HELP = (
    "Background to put behind the subject: "
    f"{', '.join(SUPPORTED_BACKGROUNDS)} (transparent keeps an alpha channel)."
)


def _process_file(
    src: Path, dst: Path, model: str, alpha_matting: bool, background: str
) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    result = remove_background(
        src.read_bytes(),
        model=model,
        alpha_matting=alpha_matting,
        background=background,
    )
    dst.write_bytes(result)


def _validate_background(background: str) -> None:
    if background not in SUPPORTED_BACKGROUNDS:
        typer.secho(
            f"Invalid --background '{background}'. "
            f"Choose one of: {', '.join(SUPPORTED_BACKGROUNDS)}.",
            fg=typer.colors.RED,
        )
        raise typer.Exit(code=2)


@app.command()
def run(
    input: Path = typer.Argument(
        ..., exists=True, dir_okay=False, readable=True, help="Source image."
    ),
    output: Optional[Path] = typer.Argument(
        None, help="Destination PNG. Defaults to <input>.out.png."
    ),
    model: str = typer.Option(DEFAULT_MODEL, "--model", "-m", help=_MODEL_HELP),
    alpha_matting: bool = typer.Option(
        False, "--alpha-matting", help="Refine edges (hair/fur). Slower."
    ),
    background: str = typer.Option(
        DEFAULT_BACKGROUND, "--background", "-b", help=_BG_HELP
    ),
):
    """Remove the background from a single image."""
    _validate_background(background)
    dst = output or input.with_suffix(".out.png")
    if dst.suffix.lower() != ".png":
        typer.secho(
            "Note: output forced to PNG.",
            fg=typer.colors.YELLOW,
        )
        dst = dst.with_suffix(".png")

    typer.echo(
        f"Processing {input} -> {dst} (model={model}, background={background}) ..."
    )
    _process_file(input, dst, model, alpha_matting, background)
    typer.secho(f"Done: {dst}", fg=typer.colors.GREEN)


@app.command()
def batch(
    input_dir: Path = typer.Argument(
        ..., exists=True, file_okay=False, readable=True, help="Folder of images."
    ),
    output_dir: Path = typer.Argument(..., help="Folder for the PNG cutouts."),
    model: str = typer.Option(DEFAULT_MODEL, "--model", "-m", help=_MODEL_HELP),
    alpha_matting: bool = typer.Option(
        False, "--alpha-matting", help="Refine edges (hair/fur). Slower."
    ),
    background: str = typer.Option(
        DEFAULT_BACKGROUND, "--background", "-b", help=_BG_HELP
    ),
):
    """Remove the background from every image in a folder."""
    _validate_background(background)
    sources = sorted(
        p for p in input_dir.iterdir() if p.suffix.lower() in _IMAGE_SUFFIXES
    )
    if not sources:
        typer.secho(f"No images found in {input_dir}.", fg=typer.colors.RED)
        raise typer.Exit(code=1)

    typer.echo(
        f"Processing {len(sources)} image(s) with model={model}, "
        f"background={background} ..."
    )
    failures = 0
    for src in sources:
        dst = output_dir / f"{src.stem}.png"
        try:
            _process_file(src, dst, model, alpha_matting, background)
            typer.secho(f"  ok  {src.name} -> {dst.name}", fg=typer.colors.GREEN)
        except Exception as exc:  # keep going on a single bad file
            failures += 1
            typer.secho(f"  err {src.name}: {exc}", fg=typer.colors.RED)

    typer.echo(f"Finished: {len(sources) - failures} ok, {failures} failed.")
    if failures:
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
