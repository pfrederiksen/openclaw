#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
test ! -e source
curl --fail --location --max-time 120 https://codeload.github.com/openclaw/openclaw/tar.gz/eb5b351e0f94dc7bf3f0390dd31064cad2ab9934 --output reviewer-source.tar.gz
node verify-archive.mjs
mkdir source
tar -xzf reviewer-source.tar.gz --strip-components=1 -C source
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
