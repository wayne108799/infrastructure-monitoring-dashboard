#!/bin/bash
set -e

echo "=============================================="
echo "Infrastructure Monitoring Dashboard Installer"
echo "Ubuntu 24.04 LTS / 22.04 LTS"
echo "=============================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo "Please run this script as a regular user with sudo privileges, not as root."
    exit 1
fi

# Detect Ubuntu version
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$NAME
    VER=$VERSION_ID
    echo "Detected: $OS $VER"
else
    echo "Warning: Could not detect OS version. Proceeding anyway..."
fi

# Configuration
INSTALL_DIR="/opt/monitoring-dashboard"
DB_USER="monitoring"
DB_NAME="monitoring_dashboard"
SERVICE_NAME="monitoring-dashboard"

echo ""
echo "This script will:"
echo "  1. Install Node.js 20.x"
echo "  2. Install and configure PostgreSQL"
echo "  3. Install and configure Nginx"
echo "  4. Download and build the application"
echo "  5. Create a systemd service"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Prompt for database password
echo ""
read -sp "Enter a password for the database user: " DB_PASSWORD
echo ""
if [ -z "$DB_PASSWORD" ]; then
    echo "Database password cannot be empty."
    exit 1
fi

# Prompt for server hostname (optional)
echo ""
read -p "Enter your server hostname (or press Enter to skip): " SERVER_HOSTNAME

echo ""
echo "Step 1: Updating system packages..."
sudo apt update && sudo apt upgrade -y

echo ""
echo "Step 2: Installing system dependencies..."
sudo apt install -y curl git build-essential

echo ""
echo "Step 3: Installing Node.js 20.x..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "Node.js already installed: $NODE_VERSION"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

echo ""
echo "Step 4: Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

echo ""
echo "Step 5: Configuring database..."
sudo -u postgres psql -c "DROP USER IF EXISTS $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
echo "Database configured successfully."

echo ""
echo "Step 6: Installing Nginx..."
sudo apt install -y nginx
sudo systemctl enable nginx

echo ""
echo "Step 7: Downloading application..."
if [ -d "$INSTALL_DIR" ]; then
    echo "Installation directory exists. Backing up..."
    sudo mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S)"
fi
sudo mkdir -p "$INSTALL_DIR"
sudo chown $USER:$USER "$INSTALL_DIR"

# Clone from GitHub (replace with actual repo URL)
echo "Please enter the Git repository URL (or press Enter to skip download):"
read -p "Repository URL: " REPO_URL
if [ -n "$REPO_URL" ]; then
    git clone "$REPO_URL" "$INSTALL_DIR"
else
    echo "Skipping git clone. Please copy application files to $INSTALL_DIR manually."
fi

echo ""
echo "Step 8: Creating environment file..."
cat > "$INSTALL_DIR/.env" << EOF
# Database Configuration
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME

# Session Secret
SESSION_SECRET=$(openssl rand -hex 32)

# Server Configuration
NODE_ENV=production
PORT=5000

# Platform connections can be configured via the Settings UI at /settings
# Or add them here:

# VCD Configuration (Optional)
# VCD_SITES=SITE1
# VCD_SITE1_URL=https://vcd.example.com
# VCD_SITE1_USERNAME=administrator
# VCD_SITE1_PASSWORD=your_password
# VCD_SITE1_ORG=System
# VCD_SITE1_NAME=VCD Site
# VCD_SITE1_LOCATION=US-East

# Veeam ONE Configuration (Optional - can also be configured via Settings UI)
# VEEAM_SITES=VEEAM1
# VEEAM_VEEAM1_URL=https://veeam-one.example.com:1239
# VEEAM_VEEAM1_USERNAME=administrator
# VEEAM_VEEAM1_PASSWORD=your_password
# VEEAM_VEEAM1_NAME=Veeam ONE
# VEEAM_VEEAM1_LOCATION=US-East
EOF
chmod 600 "$INSTALL_DIR/.env"
echo "Environment file created."

if [ -f "$INSTALL_DIR/package.json" ]; then
    echo ""
    echo "Step 9: Installing Node.js dependencies..."
    cd "$INSTALL_DIR"
    npm install

    echo ""
    echo "Step 10: Initializing database schema..."
    npm run db:push

    echo ""
    echo "Step 11: Building application..."
    npm run build
fi

echo ""
echo "Step 12: Creating systemd service..."
sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null << EOF
[Unit]
Description=Infrastructure Monitoring Dashboard
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node dist/index.cjs
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

echo ""
echo "Step 13: Setting permissions..."
sudo chown -R www-data:www-data "$INSTALL_DIR"
sudo chmod 600 "$INSTALL_DIR/.env"

echo ""
echo "Step 14: Configuring Nginx..."
NGINX_CONF="/etc/nginx/sites-available/$SERVICE_NAME"
if [ -n "$SERVER_HOSTNAME" ]; then
    SERVER_NAME="$SERVER_HOSTNAME"
else
    SERVER_NAME="_"
fi

sudo tee "$NGINX_CONF" > /dev/null << EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "Step 15: Starting services..."
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
sudo systemctl start $SERVICE_NAME

echo ""
echo "=============================================="
echo "Installation Complete!"
echo "=============================================="
echo ""
echo "Dashboard URL: http://${SERVER_HOSTNAME:-localhost}"
echo "Installation Directory: $INSTALL_DIR"
echo "Configuration File: $INSTALL_DIR/.env"
echo ""
echo "Useful commands:"
echo "  View logs:      sudo journalctl -u $SERVICE_NAME -f"
echo "  Restart:        sudo systemctl restart $SERVICE_NAME"
echo "  Stop:           sudo systemctl stop $SERVICE_NAME"
echo "  Check status:   sudo systemctl status $SERVICE_NAME"
echo ""
echo "Next steps:"
echo "  1. Edit $INSTALL_DIR/.env to add your platform credentials"
echo "  2. Or use the Settings page at http://${SERVER_HOSTNAME:-localhost}/settings"
echo "  3. Consider adding SSL with: sudo certbot --nginx"
echo ""
