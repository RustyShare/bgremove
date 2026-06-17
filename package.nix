# Nix package for bgremove, built from nixpkgs Python packages (no pip / no
# LD_LIBRARY_PATH workaround needed — nixpkgs wheels link correctly).
#
# Build:  nix build .#default     Run:  nix run .#bgremove-web
{
  lib,
  buildPythonApplication,
  hatchling,
  rembg,
  pillow,
  typer,
  fastapi,
  uvicorn,
  python-multipart,
}:

buildPythonApplication {
  pname = "bgremove";
  version = "0.1.0";
  pyproject = true;

  src = ./.;

  build-system = [ hatchling ];

  dependencies = [
    rembg # pulls in onnxruntime, pooch, pymatting, scikit-image, ...
    pillow
    typer
    fastapi
    uvicorn
    python-multipart
  ];

  # pyproject pins versions and uses extras (rembg[cpu], uvicorn[standard]) that
  # don't map to nixpkgs; relax them so the runtime-deps check passes.
  pythonRelaxDeps = true;

  pythonImportsCheck = [
    "bgremove"
    "bgremove.cli"
    "bgremove.web.app"
  ];

  # The test suite exercises the real model, which downloads ~170 MB on first
  # use — not possible inside the sandboxed build. Run `pytest` in the dev shell.
  doCheck = false;

  meta = {
    description = "Remove the background from a picture (CLI + web), powered by local ML (rembg)";
    homepage = "https://github.com/mickours/rmBackground";
    license = lib.licenses.mit;
    mainProgram = "bgremove";
  };
}
