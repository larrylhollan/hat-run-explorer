#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-}"
RESOURCE_GROUP="${RESOURCE_GROUP:-hat-run-explorer-rg}"
LOCATION="${LOCATION:-northcentralus}"
RUNTIME="${RUNTIME:-NODE:20-lts}"
SKU="${SKU:-B1}"

if [[ -z "$APP_NAME" ]]; then
  echo "APP_NAME is required"
  echo "Example: APP_NAME=hat-run-explorer-jeff-20260414 ./scripts/deploy_app_service.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building explorer data"
python3 scripts/build_hat_explorer.py

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
echo "https://$APP_NAME.azurewebsites.net"
