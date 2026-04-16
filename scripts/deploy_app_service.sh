#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# hat-run-explorer deploy script — hardened for pc.int remote execution
#
# Handles: self-update via git pull, SKIP_BUILD_DATA, python dep install,
# SCM/basic-creds open → deploy → trap-based restore on any exit.
#
# Usage:
#   APP_NAME=hatrunexplorerjeff0414 ./scripts/deploy_app_service.sh
#   APP_NAME=... SKIP_BUILD_DATA=1 ./scripts/deploy_app_service.sh
#
# Ref: HOL-4209
# ===========================================================================

# ---------------------------------------------------------------------------
# Ensure npm/node are on PATH in non-login shells (e.g. JIT SSH on pc.int).
# ---------------------------------------------------------------------------
if ! command -v npm &>/dev/null; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh"
  fi
  if ! command -v npm &>/dev/null && [[ -d "$HOME/.nvm/versions/node" ]]; then
    LATEST_NODE_DIR=$(find "$HOME/.nvm/versions/node" -maxdepth 1 -type d -name 'v*' | sort -V | tail -1)
    if [[ -n "${LATEST_NODE_DIR:-}" && -x "$LATEST_NODE_DIR/bin/npm" ]]; then
      export PATH="$LATEST_NODE_DIR/bin:$PATH"
    fi
  fi
fi

# Verify required tools before proceeding
for cmd in npm node az python3 git; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command '$cmd' not found on PATH" >&2
    echo "PATH=$PATH" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APP_NAME="${APP_NAME:-}"
RESOURCE_GROUP="${RESOURCE_GROUP:-hat-run-explorer-rg}"
LOCATION="${LOCATION:-northcentralus}"
RUNTIME="${RUNTIME:-NODE:20-lts}"
SKU="${SKU:-B1}"
SKIP_BUILD_DATA="${SKIP_BUILD_DATA:-0}"
SKIP_SELF_UPDATE="${SKIP_SELF_UPDATE:-0}"

if [[ -z "$APP_NAME" ]]; then
  echo "APP_NAME is required"
  echo "Example: APP_NAME=hatrunexplorerjeff0414 ./scripts/deploy_app_service.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Step 0: Self-update — keep this script in sync with the repo
# ---------------------------------------------------------------------------
if [[ "$SKIP_SELF_UPDATE" != "1" ]] && git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "==> Self-update: pulling latest from origin"
  if git pull --ff-only origin main 2>/dev/null; then
    echo "    Repo updated to $(git rev-parse --short HEAD)"
  else
    echo "    WARN: git pull failed (dirty tree or no network); continuing with current checkout"
  fi
fi

# ---------------------------------------------------------------------------
# Step 1: Build explorer data (unless skipped)
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD_DATA" == "1" ]]; then
  echo "==> Skipping explorer data build (SKIP_BUILD_DATA=1)"
else
  echo "==> Checking Python dependencies for data build"
  if ! python3 -c "import markdown" 2>/dev/null; then
    echo "    Installing 'markdown' package"
    python3 -m pip install --quiet markdown 2>/dev/null || pip3 install --quiet markdown
  fi

  echo "==> Building explorer data"
  python3 scripts/build_hat_explorer.py
fi

# ---------------------------------------------------------------------------
# Step 2: Install Node dependencies
# ---------------------------------------------------------------------------
echo "==> Installing Node dependencies"
npm install

# ---------------------------------------------------------------------------
# Step 3: Ensure resource group exists
# ---------------------------------------------------------------------------
echo "==> Ensuring resource group exists"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

# ---------------------------------------------------------------------------
# Step 4: Open SCM + basic creds for deploy (trap-based restore)
# ---------------------------------------------------------------------------
# Restore function — called on any exit (success, failure, signal)
restore_restrictions() {
  local rc=$?
  echo ""
  echo "==> Restoring security posture (main=Allow, SCM=Deny, creds=disabled)"

  # Main site stays publicly accessible
  az webapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --set siteConfig.ipSecurityRestrictionsDefaultAction=Allow \
    >/dev/null 2>&1 || echo "    WARN: failed to set main site to Allow"

  # Lock down SCM deploy endpoint
  az webapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --set siteConfig.scmIpSecurityRestrictionsDefaultAction=Deny \
    >/dev/null 2>&1 || echo "    WARN: failed to set SCM to Deny"

  # Disable basic publishing credentials
  az resource update \
    --resource-group "$RESOURCE_GROUP" \
    --name scm --namespace Microsoft.Web \
    --resource-type basicPublishingCredentialsPolicies \
    --parent "sites/$APP_NAME" \
    --set properties.allow=false \
    >/dev/null 2>&1 || echo "    WARN: failed to disable SCM basic auth"

  az resource update \
    --resource-group "$RESOURCE_GROUP" \
    --name ftp --namespace Microsoft.Web \
    --resource-type basicPublishingCredentialsPolicies \
    --parent "sites/$APP_NAME" \
    --set properties.allow=false \
    >/dev/null 2>&1 || echo "    WARN: failed to disable FTP basic auth"

  echo "==> Security posture restored"
  exit $rc
}
trap restore_restrictions EXIT

echo "==> Opening SCM restrictions for deploy"
az webapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set siteConfig.scmIpSecurityRestrictionsDefaultAction=Allow \
  >/dev/null

echo "==> Enabling basic publishing credentials for deploy"
az resource update \
  --resource-group "$RESOURCE_GROUP" \
  --name scm --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies \
  --parent "sites/$APP_NAME" \
  --set properties.allow=true \
  >/dev/null

az resource update \
  --resource-group "$RESOURCE_GROUP" \
  --name ftp --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies \
  --parent "sites/$APP_NAME" \
  --set properties.allow=true \
  >/dev/null

# Give Azure a moment to propagate the config change
echo "==> Waiting 15s for Azure config propagation"
sleep 15

# ---------------------------------------------------------------------------
# Step 5: Deploy
# ---------------------------------------------------------------------------
echo "==> Deploying web app via az webapp up"
az webapp up \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --runtime "$RUNTIME" \
  --sku "$SKU" \
  --track-status false

echo "==> App deployed — trap will restore security posture on exit"
echo ""
echo "==> Done. Site is live and browsable:"
echo "https://$APP_NAME.azurewebsites.net"
