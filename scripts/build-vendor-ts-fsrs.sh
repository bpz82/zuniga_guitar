#!/usr/bin/env sh
# Rebuilds vendor/ts-fsrs/dist from the pinned, unmodified upstream source in
# vendor/ts-fsrs/src. Needs bun (bundles the JavaScript) and tsc (types).
# Re-running it must produce no git diff; if it does, the vendored build no
# longer matches its source and that must be explained before committing.
#
# Upstream's package.json is stored as upstream-package.json, so npm and other
# tools never treat this folder as a package (its scripts delete files). It is
# put back only for the build, because src/constant.ts reads its version.
set -eu
cd "$(dirname "$0")/../vendor/ts-fsrs"
cp upstream-package.json package.json
trap 'rm -f package.json' EXIT
rm -rf dist
bun build src/index.ts --format esm --target browser --outfile dist/ts-fsrs.mjs >/dev/null
tsc --ignoreConfig src/index.ts --declaration --emitDeclarationOnly --outDir dist/types \
  --module esnext --moduleResolution bundler --resolveJsonModule \
  --target esnext --lib esnext --strict --skipLibCheck --types node
printf "export * from './types/src/index';\n" > dist/ts-fsrs.d.mts
echo "vendor/ts-fsrs/dist rebuilt"
