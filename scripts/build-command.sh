#!/usr/bin/env zsh
set -euo pipefail

root=${0:A:h:h}
out=${1:-$HOME/commands/quickdraw}
payload=$(mktemp -t quickdraw-payload.XXXXXX.tar.gz)
hash_file=$(mktemp -t quickdraw-hash.XXXXXX)

cleanup() {
  rm -f "$payload" "$hash_file"
}
trap cleanup EXIT

cd "$root"
tar -czf "$payload" \
  package.json \
  bun.lock \
  index.html \
  tsconfig.json \
  src \
  web \
  node_modules

shasum -a 256 "$payload" | awk '{print $1}' > "$hash_file"
hash=$(cat "$hash_file")
version=$(grep -m1 '"version"' package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

mkdir -p "${out:h}"
cat > "$out" <<EOF
#!/usr/bin/env zsh
set -euo pipefail

# Absolute path to this wrapper, captured before any cd so \`quickdraw upgrade\` can replace it.
export QUICKDRAW_SELF="\${0:A}"
export QUICKDRAW_VERSION="$version"
hash="$hash"
cache="\${XDG_CACHE_HOME:-\$HOME/.cache}/quickdraw/\$hash"
payload="\$(mktemp -t quickdraw.XXXXXX.tar.gz)"

cleanup() {
  rm -f "\$payload"
}
trap cleanup EXIT

if [[ ! -x "\$cache/node_modules/.bin/vite" || ! -f "\$cache/src/cli.ts" ]]; then
  rm -rf "\$cache"
  mkdir -p "\$cache"
  awk 'found { print } /^__QUICKDRAW_PAYLOAD__$/ { found = 1 }' "\$0" | base64 -d > "\$payload"
  tar -xzf "\$payload" -C "\$cache"
fi

cd "\$cache"
exec bun run src/cli.ts "\$@"

__QUICKDRAW_PAYLOAD__
EOF

base64 < "$payload" >> "$out"
chmod +x "$out"
printf '%s\n' "$out"
