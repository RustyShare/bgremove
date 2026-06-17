{
  description = "bgremove — remove the background from a picture (CLI + web), powered by local ML (rembg).";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    (flake-utils.lib.eachDefaultSystem (system:
      let
        # allowUnfree is needed for the CUDA packages used by the gpu shell.
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # Native libraries the pip wheels (numpy, onnxruntime) load at runtime.
        # On NixOS these are not on the default loader path, so we expose them
        # via LD_LIBRARY_PATH below.
        baseLibs = [
          pkgs.stdenv.cc.cc.lib # libstdc++.so.6
          pkgs.zlib
          pkgs.glib
        ];

        # CUDA runtime libs needed by onnxruntime-gpu's CUDA execution provider
        # (libcublasLt/libcublas, libcudart, libcudnn, libcufft, libcurand).
        cuda = pkgs.cudaPackages;
        cudaLibs = [
          cuda.libcublas
          cuda.cuda_cudart
          cuda.cudnn
          cuda.libcufft
          cuda.libcurand
        ];

        mkDevShell = libs: pkgs.mkShell {
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
        bgremove = pkgs.python3Packages.callPackage ./package.nix { };
      in
      {
        # Packaged app (no pip / no LD_LIBRARY_PATH needed): nix build
        packages.default = bgremove;
        packages.bgremove = bgremove;

        # nix run            -> the web server
        # nix run .#bgremove -> the CLI
        apps.default = {
          type = "app";
          program = "${bgremove}/bin/bgremove-web";
        };
        apps.bgremove = {
          type = "app";
          program = "${bgremove}/bin/bgremove";
        };

        # CPU shell (default): nix develop
        devShells.default = mkDevShell baseLibs;

        # GPU shell: nix develop .#gpu  (adds the CUDA libs to LD_LIBRARY_PATH).
        # Install the GPU runtime into the venv with: pip install -e ".[gpu]"
        devShells.gpu = mkDevShell (baseLibs ++ cudaLibs);
      }))
    // {
      # NixOS module (system-independent): add to a host's imports and set
      # services.bgremove.enable = true;
      nixosModules.default = import ./nixos-module.nix { inherit self; };
    };
}
