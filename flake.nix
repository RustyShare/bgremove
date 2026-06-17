{
  description = "bgremove — remove the background from a picture (CLI + web), powered by local ML (rembg).";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Native libraries the pip wheels (numpy, onnxruntime) load at runtime.
        # On NixOS these are not on the default loader path, so we expose them
        # via LD_LIBRARY_PATH below.
        libs = [
          pkgs.stdenv.cc.cc.lib # libstdc++.so.6
          pkgs.zlib
          pkgs.glib
        ];
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.python3
            pkgs.python3Packages.pip
            pkgs.python3Packages.venvShellHook
          ];

          venvDir = "./.venv";
          buildInputs = libs;
          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath libs;

          postVenvCreation = ''
            pip install --upgrade pip
            pip install -e ".[dev]"
          '';

          postShellHook = ''
            echo "bgremove dev shell ready — try:  bgremove --help   |   bgremove-web   |   pytest"
          '';
        };
      });
}
