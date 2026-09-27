#!/bin/sh
# Point the local Hermes profile at xAI Grok OAuth and install the TKU AI skill.
# Does not print tokens. Does not write instruction files outside HERMES_HOME/skills.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
HOME_DIR=${HERMES_HOME:-"$HOME/.hermes"}
mkdir -p "$HOME_DIR/skills/tku-zenclub"
cp "$ROOT/skills/tku-zenclub/SKILL.md" "$HOME_DIR/skills/tku-zenclub/SKILL.md"
if ! command -v hermes >/dev/null 2>&1; then
  echo "hermes CLI not found. Install Hermes Agent before applying the profile." >&2
  exit 1
fi
hermes config set model.provider xai-oauth
hermes config set model.default grok-4.6
hermes config set model.base_url https://api.x.ai/v1
if [ ! -f "$HOME_DIR/.env" ] || ! grep -q '^API_SERVER_ENABLED=' "$HOME_DIR/.env"; then
  umask 077
  KEY=$(openssl rand -hex 32)
  {
    echo "API_SERVER_ENABLED=true"
    echo "API_SERVER_HOST=0.0.0.0"
    echo "API_SERVER_PORT=8642"
    echo "API_SERVER_KEY=$KEY"
    echo "API_SERVER_MODEL_NAME=hermes-agent"
  } >> "$HOME_DIR/.env"
  chmod 600 "$HOME_DIR/.env"
  echo "API server key written to $HOME_DIR/.env (not printed)."
fi
echo "TKU AI skill installed at $HOME_DIR/skills/tku-zenclub"
echo "Next: hermes auth add xai-oauth --no-browser"
echo "Then: hermes gateway"
