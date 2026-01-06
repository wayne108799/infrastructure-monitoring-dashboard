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

echo "[1/7] Pulling latest code from git..."
sudo -u "$APP_USER" git fetch origin
sudo -u "$APP_USER" git reset --hard origin/main
chmod +x "$APP_DIR/deploy.sh"
echo "      Done."
echo ""

echo "[2/7] Fixing permissions..."
sudo chown "$APP_USER:$APP_USER" "$APP_DIR/.env" 2>/dev/null || true
sudo chmod 640 "$APP_DIR/.env" 2>/dev/null || true
echo "      Done."
echo ""

echo "[3/7] Installing all dependencies (including build tools)..."
sudo -u "$APP_USER" npm install
echo "      Done."
echo ""

echo "[4/7] Building application..."
sudo -u "$APP_USER" npm run build
echo "      Done."
echo ""

echo "[5/7] Running database migrations..."
set -a
source "$APP_DIR/.env"
set +a
sudo -E -u "$APP_USER" npm run db:push
echo "      Done."
echo ""

echo "[6/7] Cleaning up dev dependencies..."
sudo -u "$APP_USER" npm prune --omit=dev
echo "      Done."
echo ""

echo "[7/7] Restarting service..."
sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sleep 3

if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "      Service is running."
    echo ""
    echo "      Checking for auth initialization..."
    if sudo journalctl -u "$SERVICE_NAME" -n 30 --no-pager | grep -q "\[auth\]"; then
        echo "      Authentication system initialized."
    fi
else
    echo "      WARNING: Service may not be running correctly."
    echo "      Check logs with: sudo journalctl -u $SERVICE_NAME -n 50"
fi
echo ""

echo "=========================================="
echo "Deployment complete!"
echo "=========================================="
echo ""
echo "Access dashboard: https://$(hostname -f) or http://$(hostname -I | awk '{print $1}')"
echo "Default login:    admin / admin (change immediately!)"
echo ""
echo "View logs:    sudo journalctl -u $SERVICE_NAME -f"
echo "Check status: sudo systemctl status $SERVICE_NAME"
echo ""
