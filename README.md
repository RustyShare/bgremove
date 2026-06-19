# bgremove

Remove the background from a picture, keeping only the main subject.

`bgremove` ships **two frontends over one shared core**:

- a **CLI** for single images and batch folders, and
- a **web app** with a drag-and-drop UI that previews the cutout and lets you download it.

Background removal runs **locally** using [`rembg`](https://github.com/danielgatis/rembg)
(U2Net / ISNet ONNX models on `onnxruntime`). No API keys, no per-image cost, and your
images never leave your machine.

> See [`DESIGN.md`](./DESIGN.md) for the architecture and the reasoning behind the choices.

---

## Install

Requires Python ≥ 3.9.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"      # drop [dev] if you don't need the test deps
```

### On NixOS (recommended)

Use the provided Nix shell — it puts the native libraries the pip wheels need
(`libstdc++`, `zlib`, `glib`) on the loader path and bootstraps the virtualenv for you, so
install and run work out of the box:

```bash
nix-shell              # classic; creates ./.venv and installs deps on first entry
# or, with flakes:
nix develop
```

Inside the shell, `bgremove`, `bgremove-web`, and `pytest` are ready to use. See the
[NixOS note](#nixos-note) below for what this works around.

> **First run downloads a model** (~170 MB, cached under `~/.u2net/`). It happens
> automatically the first time you process an image; later runs are offline.

### Nix package & flake

The flake also builds a real package (using nixpkgs Python deps — no pip, no
`LD_LIBRARY_PATH` workaround):

```bash
nix build              # -> ./result/bin/{bgremove,bgremove-web}
nix run                # run the web server
nix run .#bgremove -- run photo.jpg   # run the CLI
```

### Docker container

The flake builds a container image with [nix2container](https://github.com/nlewo/nix2container)
that runs the web server on `0.0.0.0:8000`:

```bash
nix run .#container.copyToDockerDaemon   # load into the local Docker daemon
docker run --rm -p 8000:8000 ghcr.io/rustyshare/bgremove:latest
```

CI publishes it to `ghcr.io/rustyshare/bgremove` (tags `latest` and the commit SHA). The
model downloads to `/models` on first request, so the container needs network access then
(CA certs are baked in); mount a volume at `/models` to cache it across runs.

### NixOS service

The flake exposes `nixosModules.default`, a `services.bgremove` systemd service. In a
flake-based system config:

```nix
{
  inputs.bgremove.url = "github:RustyShare/bgremove";

  # in your nixosSystem modules:
  imports = [ inputs.bgremove.nixosModules.default ];
  services.bgremove = {
    enable = true;
    host = "0.0.0.0";     # default 127.0.0.1
    port = 8000;
    openFirewall = true;  # default false

    # Optional: front it with an nginx reverse-proxy virtualHost.
    nginx = {
      enable = true;
      fqdn = "bgremove.example.com";
      enableACME = true;  # Let's Encrypt cert + force HTTPS (default false)
    };
  };
}
```

The service runs as a hardened `DynamicUser`, caches models under
`/var/lib/bgremove/models` (`U2NET_HOME`), and pulls the model on first request (needs
network). Host/port are passed via `BGREMOVE_HOST` / `BGREMOVE_PORT`.

With `nginx.enable`, the module configures `services.nginx` with a virtualHost for
`nginx.fqdn` proxying to the service (raising `client_max_body_size` to 25 MB to match the
upload limit) and opens ports 80/443. `enableACME` provisions a Let's Encrypt certificate
and forces HTTPS (you must accept the ACME terms, e.g. `security.acme.acceptTerms = true`).

### GPU (NVIDIA + CUDA) on NixOS

Use the GPU shell, which additionally puts the CUDA runtime libraries that onnxruntime-gpu
needs (`libcublasLt`/`libcublas`, `libcudart`, `libcudnn`, `libcufft`, `libcurand`) on the
loader path — fixing errors like `libcublasLt.so.12: cannot open shared object file`:

```bash
nix-shell --arg cudaSupport true     # classic
# or, with flakes:
nix develop .#gpu
```

Then install the GPU runtime into the venv: `pip install -e ".[gpu]"`.

CUDA is unfree and large, so it is opt-in — the default (CPU) shell pulls none of it. The
first entry into the GPU shell downloads the CUDA libraries (cuDNN is several hundred MB).

### NixOS note

On NixOS, the pip-installed `numpy`/`onnxruntime` wheels fail to load `libstdc++.so.6`
unless the loader can find it. **The recommended fix is the [Nix shell](#on-nixos-recommended)
above** (`nix-shell` / `nix develop`), which sets this up automatically.

If you instead use a plain pip venv outside the Nix shell, point `LD_LIBRARY_PATH` at a gcc
lib in the Nix store before running anything that imports `rembg`:

```bash
export LD_LIBRARY_PATH="$(dirname "$(find /nix/store -name 'libstdc++.so.6' | head -1)"):$LD_LIBRARY_PATH"
```

---

## CLI

```bash
# Single image -> writes photo.out.png next to it
bgremove run photo.jpg

# Choose the output path explicitly
bgremove run photo.jpg cutout.png

# A whole folder -> one PNG per input in ./out
bgremove batch ./photos ./out

# Pick a model and refine edges (good for hair/fur)
bgremove run portrait.jpg --model u2net_human_seg --alpha-matting

# Put the subject on a solid white (or black) background instead of transparent
bgremove run photo.jpg --background white
```

Output is always PNG. With `--background transparent` (default) it has an alpha channel;
with `white`/`black` the subject is composited onto that solid color (opaque RGB).

Available models (`--model`): `u2net` (default, general), `isnet-general-use` (sharper
edges), `u2net_human_seg` (people), `u2netp` (fast/light), `silueta` (small download).

Backgrounds (`--background` / `-b`): `transparent` (default), `white`, `black`.

Run `bgremove --help` or `bgremove run --help` for all options.

---

## Web app

```bash
bgremove-web
# then open http://127.0.0.1:8000
```

Drag **one or more** images onto the page (or click to choose multiple, or paste from the
clipboard), pick a model, and download the transparent PNGs. Each image gets its own card
showing the cutout over a checkerboard (so transparency is obvious) with a per-image
**Download**, plus a **Download all** button that bundles every cutout into a single
`bgremoved-<date>.zip` (built client-side) — the web equivalent of the CLI's `batch` command.
A **Background** selector (Transparent / White / Black) puts the subject on a solid color
instead of transparency. Changing the model or background and clicking **Re-run** re-applies
it to the same set without re-uploading.

Under the hood it's a FastAPI service:

| Method | Path          | Description                              |
| ------ | ------------- | ---------------------------------------- |
| `GET`  | `/`           | The single-page UI                       |
| `POST` | `/api/remove` | Multipart upload → returns the PNG cutout |
| `GET`  | `/api/health` | Liveness probe                           |

Example with `curl`:

```bash
curl -F "file=@photo.jpg" -F "model=u2net" \
  http://127.0.0.1:8000/api/remove --output cutout.png
```

For a production deployment, run it under a process manager / multiple workers, e.g.
`uvicorn bgremove.web.app:app --host 0.0.0.0 --port 8000 --workers 2`.

---

## Use it as a library

```python
from bgremove import remove_background

png_bytes = remove_background(open("photo.jpg", "rb").read())
open("cutout.png", "wb").write(png_bytes)
```

---

## Tests

```bash
pytest
```

The suite synthesizes a tiny test image at runtime (no fixtures committed) and exercises
the real model, so the first invocation triggers the one-time model download. Tests skip
gracefully if `rembg` isn't installed.

---

## Project layout

```
src/bgremove/
  core.py            # the single place that talks to rembg
  cli.py             # Typer CLI (run / batch)
  web/app.py         # FastAPI app + static UI
  web/static/        # drag-and-drop frontend (no build step)
tests/               # core + web tests
DESIGN.md            # architecture & decisions
```

## Development

```bash
nix develop          # or: nix-shell — venv + LD_LIBRARY_PATH set up for you
pytest               # run the tests
bgremove-web         # serve the UI at http://127.0.0.1:8000
```

Quirks worth knowing:

- **Frontend has no build step.** `web/static/` is served straight from disk, and the
  server sends `Cache-Control: no-cache`, so a **hard-refresh** picks up HTML/CSS/JS edits.
  Python changes need a **server restart**.
- **NixOS / pip wheels.** Outside the Nix shell, the pip-installed `numpy`/`onnxruntime`
  wheels can't find `libstdc++` — the dev shell puts it on `LD_LIBRARY_PATH`, and the
  packaged app preloads it itself (see [`core.py`](src/bgremove/core.py)). See the
  [NixOS note](#nixos-note).
- **Runtime caches.** Models download once to `~/.u2net` (override with `U2NET_HOME`); alpha
  matting's numba cache goes to `NUMBA_CACHE_DIR` (defaults to a temp dir).
- **Translations** live in the `TRANSLATIONS` map in
  [`web/static/app.js`](src/bgremove/web/static/app.js). To add a language, add a key block
  (keep key parity with `en`) and an `<option>` to the `#lang` selector in `index.html`.

### Releasing

Bump the version everywhere it's declared (pyproject, Nix package, `__version__`) with the
helper, then commit and tag:

```bash
scripts/bump-version.sh minor      # or: patch | major | 1.2.3
scripts/bump-version.sh            # no args: print + check version consistency
git commit -am "Release v0.2.0" && git tag v0.2.0
git push --follow-tags
```

Pushing to `main` (or a `v*` tag) runs CI, which builds the Python package (sdist + wheel)
and publishes the container to `ghcr.io/rustyshare/bgremove` (tags `latest` and the commit
SHA).

## License

MIT.
