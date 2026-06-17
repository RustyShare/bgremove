# Development shell for bgremove on NixOS.
#
#   nix-shell            # enter the shell (creates/activates .venv, installs deps)
#
# Why this is needed: bgremove depends on pip-installed binary wheels (numpy,
# onnxruntime via rembg) that dynamically link against libstdc++ and friends.
# On NixOS those libraries are not on the default loader path, so a plain
# `pip install` + run fails with "libstdc++.so.6: cannot open shared object
# file". This shell puts the right libraries on LD_LIBRARY_PATH and bootstraps a
# virtualenv, so install and run work flawlessly.

{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = [
    pkgs.python3
    pkgs.python3Packages.pip
    pkgs.python3Packages.venvShellHook
  ];

  # Use a project-local virtualenv.
  venvDir = "./.venv";

  # Native libraries the pip wheels load at runtime.
  buildInputs = [
    pkgs.stdenv.cc.cc.lib # libstdc++.so.6 (numpy, onnxruntime)
    pkgs.zlib             # libz (image codecs, onnxruntime)
    pkgs.glib             # libgthread/libglib (onnxruntime)
  ];

  LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
    pkgs.stdenv.cc.cc.lib
    pkgs.zlib
    pkgs.glib
  ];

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
