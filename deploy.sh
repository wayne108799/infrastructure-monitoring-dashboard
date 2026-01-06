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

echo "[1/6] Pulling latest code from git..."
sudo -u "$APP_USER" git fetch origin
sudo -u "$APP_USER" git reset --hard origin/main
chmod +x "$APP_DIR/deploy.sh"
echo "      Done."
echo ""

echo "[2/6] Fixing permissions..."
sudo chown "$APP_USER:$APP_USER" "$APP_DIR/.env" 2>/dev/null || true
sudo chmod 644 "$APP_DIR/.env" 2>/dev/null || true
echo "      Done."
echo ""

echo "[3/6] Installing dependencies..."
sudo -u "$APP_USER" npm install --omit=dev
echo "      Done."
echo ""

echo "[4/6] Building application..."
sudo -u "$APP_USER" npm run build
echo "      Done."
echo ""

echo "[5/6] Running database migrations..."
set -a
source "$APP_DIR/.env"
set +a
sudo -E -u "$APP_USER" npm run db:push
echo "      Done."
echo ""

echo "[6/6] Restarting service..."
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
echo "Access dashboard: https://$(hostname -f)"
echo "Default login:    admin / admin (change immediately!)"
echo ""
echo "View logs:    sudo journalctl -u $SERVICE_NAME -f"
echo "Check status: sudo systemctl status $SERVICE_NAME"
echo ""
