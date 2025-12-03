#!/bin/bash
# Infrastructure Monitoring Dashboard - Ubuntu Quick Setup Script
# Compatible with Ubuntu 22.04 LTS and Ubuntu 24.04 LTS
# Run as root or with sudo

set -e

echo "=========================================="
echo "Infrastructure Monitoring Dashboard Setup"
echo "=========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root or with sudo"
    exit 1
fi

# Check Ubuntu version
. /etc/os-release
echo "Detected: $PRETTY_NAME"

if [[ "$VERSION_ID" != "22.04" && "$VERSION_ID" != "24.04" ]]; then
    echo "Warning: This script is tested on Ubuntu 22.04 and 24.04 LTS"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get the actual user (not root)
ACTUAL_USER=${SUDO_USER:-$USER}

echo ""
echo "[1/7] Updating system packages..."
apt update && apt upgrade -y

echo ""
echo "[2/7] Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git build-essential

echo "Node.js version: $(node --version)"
echo "NPM version: $(npm --version)"

echo ""
echo "[3/7] Installing PostgreSQL..."
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

echo ""
echo "[4/7] Creating database..."
read -p "Enter database password for 'monitoring' user: " -s DB_PASSWORD
echo ""

sudo -u postgres psql << EOF
CREATE USER monitoring WITH PASSWORD '$DB_PASSWORD';
CREATE DATABASE monitoring_dashboard OWNER monitoring;
GRANT ALL PRIVILEGES ON DATABASE monitoring_dashboard TO monitoring;
EOF

echo "Database created successfully!"

echo ""
echo "[5/7] Setting up application directory..."
mkdir -p /opt/monitoring-dashboard
chown $ACTUAL_USER:$ACTUAL_USER /opt/monitoring-dashboard

echo ""
echo "[6/7] Installing Nginx..."
apt install -y nginx

echo ""
echo "[7/7] Creating systemd service..."
cat > /etc/systemd/system/monitoring-dashboard.service << 'EOF'
[Unit]
Description=Infrastructure Monitoring Dashboard
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/monitoring-dashboard
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=monitoring-dashboard
Environment=NODE_ENV=production
Environment=PORT=5000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

echo ""
echo "=========================================="
echo "System setup complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Clone the repository:"
echo "   cd /opt/monitoring-dashboard"
echo "   git clone https://github.com/YOUR_USERNAME/REPO_NAME.git ."
echo ""
echo "2. Create .env file with your configuration:"
echo "   nano /opt/monitoring-dashboard/.env"
echo ""
echo "   DATABASE_URL=postgresql://monitoring:$DB_PASSWORD@localhost:5432/monitoring_dashboard"
echo "   SESSION_SECRET=$(openssl rand -hex 32)"
echo ""
echo "3. Install dependencies and build:"
echo "   npm install"
echo "   npm run db:push"
echo "   npm run build"
echo ""
echo "4. Set ownership and start service:"
echo "   sudo chown -R www-data:www-data /opt/monitoring-dashboard"
echo "   sudo systemctl enable monitoring-dashboard"
echo "   sudo systemctl start monitoring-dashboard"
echo ""
echo "5. Configure Nginx (see DEPLOYMENT.md for details)"
echo ""
