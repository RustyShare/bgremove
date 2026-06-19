#!/usr/bin/env bash
#
# Bump the project version in every place it is declared:
#   - pyproject.toml          (version = "...")
#   - package.nix             (version = "...";)
#   - src/bgremove/__init__.py (__version__ = "...")
#
# The container image and the Nix package take their version from package.nix /
# pyproject, so bumping here propagates to `nix build`/`nix build .#container`.
# (The image's :latest / :<sha> tags are set by CI and are independent.)
#
# Usage:
#   scripts/bump-version.sh <X.Y.Z>     # set an explicit version
#   scripts/bump-version.sh major|minor|patch
#   scripts/bump-version.sh             # show current version + check consistency
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
pyproject="$root/pyproject.toml"
init="$root/src/bgremove/__init__.py"
pkgnix="$root/package.nix"

err() { echo "error: $*" >&2; exit 1; }

cur_pyproject="$(sed -nE 's/^version = "(.*)"/\1/p' "$pyproject" | head -n1)"
cur_init="$(sed -nE 's/^__version__ = "(.*)"/\1/p' "$init" | head -n1)"
cur_nix="$(sed -nE 's/.*version = "([0-9][^"]*)";.*/\1/p' "$pkgnix" | head -n1)"

[ -n "$cur_pyproject" ] || err "could not read version from $pyproject"

# No argument: report current versions and whether they agree.
if [ $# -eq 0 ]; then
  echo "pyproject.toml : $cur_pyproject"
  echo "package.nix    : $cur_nix"
  echo "__init__.py    : $cur_init"
  if [ "$cur_pyproject" = "$cur_nix" ] && [ "$cur_pyproject" = "$cur_init" ]; then
    echo "OK: versions are consistent."
  else
    err "versions are INCONSISTENT (run with a version to fix)."
  fi
  exit 0
fi

current="$cur_pyproject"
arg="$1"
case "$arg" in
  major | minor | patch)
    IFS=. read -r MA MI PA <<<"${current%%[-+]*}" || true
    [ -n "${PA:-}" ] || err "current version '$current' is not X.Y.Z; pass an explicit version"
    case "$arg" in
      major) MA=$((MA + 1)); MI=0; PA=0 ;;
      minor) MI=$((MI + 1)); PA=0 ;;
      patch) PA=$((PA + 1)) ;;
    esac
    new="$MA.$MI.$PA"
    ;;
  *)
    echo "$arg" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+([.+-][0-9A-Za-z.]+)?$' \
      || err "invalid version '$arg' (expected X.Y.Z[-suffix])"
    new="$arg"
    ;;
esac

echo "Bumping version: $current -> $new"

sed -i -E "s/^version = \".*\"/version = \"$new\"/" "$pyproject"
sed -i -E "s/^__version__ = \".*\"/__version__ = \"$new\"/" "$init"
sed -i -E "s/(version = \")[0-9][^\"]*(\";)/\1$new\2/" "$pkgnix"

echo "Updated:"
grep -nE '^version = "' "$pyproject" | sed 's/^/  pyproject.toml:/'
grep -nE '__version__ = "' "$init" | sed 's/^/  __init__.py:/'
grep -nE 'version = "[0-9]' "$pkgnix" | sed 's/^/  package.nix:/'
echo
echo "Next: review the diff, then commit, e.g."
echo "  git commit -am \"Release v$new\" && git tag v$new"
