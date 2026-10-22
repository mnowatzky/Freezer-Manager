#!/bin/sh
# Writes secrets.yaml for the dev Home Assistant: the API token and the URLs of one freezer.
# Usage: dev/home-assistant/write-secrets.sh fm_… [freezer-id]
# Without a freezer ID it takes your first freezer. The API must be running (pnpm dev).
set -eu
token="${1:?usage: $0 <api-token> [freezer-id]}"
api="http://localhost:${API_PORT:-3000}/api/v1"
freezer="${2:-}"
if [ -z "$freezer" ]; then
  freezer=$(curl -fsS -H "Authorization: Bearer $token" "$api/freezers" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s);if(!f.length){console.error("No freezers for this token.");process.exit(1)}console.error(`Using freezer "${f[0].name}" (${f[0].id})`);console.log(f[0].id)})')
fi
# Home Assistant runs in Docker and reaches the API on the host.
base="http://host.docker.internal:${API_PORT:-3000}/api/v1/freezers/$freezer"
cat > "$(dirname "$0")/secrets.yaml" <<YAML
freezer_token: "Bearer $token"
freezer_summary_url: "$base/summary"
freezer_items_url: "$base/items"
freezer_take_url: "$base/take"
YAML
echo "Wrote $(dirname "$0")/secrets.yaml. Restart Home Assistant to load it."
