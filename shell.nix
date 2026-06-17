# Development shell for bgremove on NixOS.
#
#   nix-shell                       # CPU shell (creates/activates .venv, installs deps)
#   nix-shell --arg cudaSupport true  # also put the CUDA runtime libs on LD_LIBRARY_PATH
#
# Why this is needed: bgremove depends on pip-installed binary wheels (numpy,
# onnxruntime via rembg) that dynamically link against libstdc++ and friends.
# On NixOS those libraries are not on the default loader path, so a plain
# `pip install` + run fails with "libstdc++.so.6: cannot open shared object
# file". This shell puts the right libraries on LD_LIBRARY_PATH and bootstraps a
# virtualenv, so install and run work flawlessly.
#
# With cudaSupport, the CUDA libraries that onnxruntime-gpu's CUDA execution
# provider needs (libcublasLt/libcublas, libcudart, libcudnn, libcufft,
# libcurand) are added too, fixing errors like "libcublasLt.so.12: cannot open
# shared object file". CUDA is unfree, so it is opt-in: CPU users pull nothing.

{ pkgs ? import <nixpkgs> { config.allowUnfree = true; }
, cudaSupport ? false
}:

let
  baseLibs = [
    pkgs.stdenv.cc.cc.lib # libstdc++.so.6 (numpy, onnxruntime)
    pkgs.zlib             # libz (image codecs, onnxruntime)
    pkgs.glib             # libgthread/libglib (onnxruntime)
  ];

  cuda = pkgs.cudaPackages;
  cudaLibs = [
    cuda.libcublas    # libcublas.so.12, libcublasLt.so.12
    cuda.cuda_cudart  # libcudart.so.12
    cuda.cudnn        # libcudnn.so.9
    cuda.libcufft     # libcufft.so.11
    cuda.libcurand    # libcurand.so.10
  ];

  libs = baseLibs ++ pkgs.lib.optionals cudaSupport cudaLibs;
in
pkgs.mkShell {
  packages = [
    pkgs.python3
    pkgs.python3Packages.pip
    pkgs.python3Packages.venvShellHook
  ];

  # Use a project-local virtualenv.
  venvDir = "./.venv";

  # Native libraries the pip wheels load at runtime.
  buildInputs = libs;
  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath libs;

  # venvShellHook creates+activates ./.venv. postVenvCreation runs only when the
  # venv is first created; postShellHook runs on every entry.
  postVenvCreation = ''
    pip install --upgrade pip
    pip install -e ".[dev]"
  '';

  postShellHook = ''
    echo "bgremove dev shell ready — try:  bgremove --help   |   bgremove-web   |   pytest"
  '';
}
