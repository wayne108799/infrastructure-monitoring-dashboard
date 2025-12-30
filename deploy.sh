#!/bin/bash
set -e

APP_DIR="/opt/monitoring-dashboard"
SERVICE_NAME="monitoring-dashboard"
APP_USER="www-data"

echo "=========================================="
echo "Infrastructure Monitoring Dashboard"
echo "Deployment Script"
echo "=========================================="
echo ""

cd "$APP_DIR"

echo "[1/5] Pulling latest code from git..."
sudo -u "$APP_USER" git fetch origin
sudo -u "$APP_USER" git reset --hard origin/main
echo "      Done."
echo ""

echo "[2/5] Installing dependencies..."
sudo -u "$APP_USER" npm install --production=false
echo "      Done."
echo ""

echo "[3/5] Running database migrations..."
sudo -u "$APP_USER" npm run db:push
echo "      Done."
echo ""

echo "[4/5] Building application..."
sudo -u "$APP_USER" npm run build
echo "      Done."
echo ""

echo "[5/5] Restarting service..."
sudo systemctl restart "$SERVICE_NAME"
sleep 2

if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "      Service is running."
else
    echo "      WARNING: Service may not be running correctly."
    echo "      Check logs with: sudo journalctl -u $SERVICE_NAME -n 50"
fi
echo ""

echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
echo ""
echo "View logs:    sudo journalctl -u $SERVICE_NAME -f"
echo "Check status: sudo systemctl status $SERVICE_NAME"
echo ""
