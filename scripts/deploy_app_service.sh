#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-}"
RESOURCE_GROUP="${RESOURCE_GROUP:-hat-run-explorer-rg}"
LOCATION="${LOCATION:-northcentralus}"
RUNTIME="${RUNTIME:-NODE:20-lts}"
SKU="${SKU:-B1}"
SKIP_BUILD_DATA="${SKIP_BUILD_DATA:-0}"

if [[ -z "$APP_NAME" ]]; then
  echo "APP_NAME is required"
  echo "Example: APP_NAME=hat-run-explorer-jeff-20260414 ./scripts/deploy_app_service.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ "$SKIP_BUILD_DATA" == "1" ]]; then
  echo "==> Skipping explorer data build (SKIP_BUILD_DATA=1)"
else
  echo "==> Building explorer data"
  python3 scripts/build_hat_explorer.py
fi

echo "==> Installing Node dependencies"
npm install

echo "==> Ensuring resource group exists"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" >/dev/null

echo "==> Deploying web app"
az webapp up \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --runtime "$RUNTIME" \
  --sku "$SKU" \
  --track-status false

echo "==> App deployed"

# ---------------------------------------------------------------------------
# Post-deploy: ensure the main site stays publicly accessible while SCM
# (the deploy endpoint) is locked down.  Previous deploys were accidentally
# restoring both to Deny, which blocked Jeff from browsing the explorer.
# ---------------------------------------------------------------------------
echo "==> Ensuring main site is publicly accessible (Allow)"
az webapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set siteConfig.ipSecurityRestrictionsDefaultAction=Allow \
  >/dev/null

echo "==> Locking down SCM deploy endpoint (Deny)"
az webapp update \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set siteConfig.scmIpSecurityRestrictionsDefaultAction=Deny \
  >/dev/null

# Disable basic auth publishing creds when not actively deploying
echo "==> Disabling basic publishing credentials"
az resource update \
  --resource-group "$RESOURCE_GROUP" \
  --name scm --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies \
  --parent "sites/$APP_NAME" \
  --set properties.allow=false \
  >/dev/null 2>&1 || true
az resource update \
  --resource-group "$RESOURCE_GROUP" \
  --name ftp --namespace Microsoft.Web \
  --resource-type basicPublishingCredentialsPolicies \
  --parent "sites/$APP_NAME" \
  --set properties.allow=false \
  >/dev/null 2>&1 || true

echo "==> Done. Site is live and browsable:"
echo "https://$APP_NAME.azurewebsites.net"
