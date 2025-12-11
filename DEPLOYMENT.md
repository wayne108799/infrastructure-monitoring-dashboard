# Infrastructure Monitoring Dashboard - Ubuntu Deployment Guide

This guide covers deploying the Multi-Platform Infrastructure Monitoring Dashboard on an Ubuntu server.

## Prerequisites

- **Ubuntu 24.04 LTS** (recommended) or **Ubuntu 22.04 LTS**
- Root or sudo access
- Minimum 2 GB RAM, 20 GB disk space
- Network access to your VCD, CloudStack, Proxmox, and/or Veeam ONE systems

> **Recommended:** Ubuntu 24.04 LTS includes PostgreSQL 16, improved security features, and long-term support until 2034.

---

## Automated Installation (Recommended)

Download and run the install script for a fully automated setup:

```bash
# One-liner: Download and run the installer
wget https://raw.githubusercontent.com/wayne108799/infrastructure-monitoring-dashboard/main/install.sh && chmod +x install.sh && ./install.sh

# Or step-by-step:
# wget https://raw.githubusercontent.com/wayne108799/infrastructure-monitoring-dashboard/main/install.sh
# chmod +x install.sh
# ./install.sh
```

The script will:
- Install Node.js 20.x, PostgreSQL, and Nginx
- Create the database and user
- Configure the application
- Set up a systemd service
- Configure Nginx as a reverse proxy

---

## Manual Installation

If you prefer manual installation, follow the steps below.

### Step 1: Update System and Install Dependencies

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install required system packages
sudo apt install -y curl git build-essential

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x
```

---

## Step 2: Install and Configure PostgreSQL

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE USER monitoring WITH PASSWORD 'your_secure_password_here';
CREATE DATABASE monitoring_dashboard OWNER monitoring;
GRANT ALL PRIVILEGES ON DATABASE monitoring_dashboard TO monitoring;
\q
EOF
```

---

## Step 3: Clone the Repository

```bash
# Create application directory
sudo mkdir -p /opt/monitoring-dashboard
sudo chown $USER:$USER /opt/monitoring-dashboard

# Clone from GitHub (replace with your repository URL)
cd /opt/monitoring-dashboard
git clone https://github.com/wayne108799/infrastructure-monitoring-dashboard.git .
```

---

## Step 4: Configure Environment Variables

```bash
# Create environment file
cat > /opt/monitoring-dashboard/.env << 'EOF'
# Database Configuration
DATABASE_URL=postgresql://monitoring:your_secure_password_here@localhost:5432/monitoring_dashboard

# Session Secret (generate a random string)
SESSION_SECRET=your_random_session_secret_here

# ===========================================
# VMware Cloud Director Sites (Optional)
# ===========================================
# VCD_SITES=SITE1,SITE2
# VCD_SITE1_URL=https://vcd.example.com
# VCD_SITE1_USERNAME=administrator
# VCD_SITE1_PASSWORD=your_password
# VCD_SITE1_ORG=System
# VCD_SITE1_NAME=VCD Site 1
# VCD_SITE1_LOCATION=Datacenter 1

# ===========================================
# Apache CloudStack Sites (Optional)
# ===========================================
# CLOUDSTACK_SITES=CS1,CS2
# CLOUDSTACK_CS1_URL=https://cloudstack.example.com
# CLOUDSTACK_CS1_API_KEY=your_api_key
# CLOUDSTACK_CS1_SECRET_KEY=your_secret_key
# CLOUDSTACK_CS1_NAME=CloudStack Site 1
# CLOUDSTACK_CS1_LOCATION=Datacenter 1

# ===========================================
# Proxmox VE Sites (Optional)
# ===========================================
# PROXMOX_SITES=PVE1,PVE2
# PROXMOX_PVE1_URL=https://proxmox.example.com:8006
# PROXMOX_PVE1_USERNAME=root
# PROXMOX_PVE1_PASSWORD=your_password
# PROXMOX_PVE1_REALM=pam
# PROXMOX_PVE1_NAME=Proxmox Cluster 1
# PROXMOX_PVE1_LOCATION=Datacenter 1
EOF

# Secure the environment file
chmod 600 /opt/monitoring-dashboard/.env
```

**Edit the .env file with your actual credentials:**
```bash
nano /opt/monitoring-dashboard/.env
```

---

## Step 5: Install Dependencies and Build

```bash
cd /opt/monitoring-dashboard

# Install Node.js dependencies
npm install

# Initialize database schema
npm run db:push

# Build the application
npm run build
```

---

## Step 6: Create Systemd Service

```bash
# Create systemd service file
sudo tee /etc/systemd/system/monitoring-dashboard.service << 'EOF'
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

# Set ownership
sudo chown -R www-data:www-data /opt/monitoring-dashboard

# Reload systemd and start service
sudo systemctl daemon-reload
sudo systemctl enable monitoring-dashboard
sudo systemctl start monitoring-dashboard

# Check status
sudo systemctl status monitoring-dashboard
```

---

## Step 7: Configure Nginx Reverse Proxy (Recommended)

```bash
# Install Nginx
sudo apt install -y nginx

# Create Nginx configuration
sudo tee /etc/nginx/sites-available/monitoring-dashboard << 'EOF'
server {
    listen 80;
    server_name your-server-hostname.example.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/monitoring-dashboard /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test and restart Nginx
sudo nginx -t
sudo systemctl restart nginx
```

---

## Step 8: Configure Firewall (Optional)

```bash
# Allow HTTP and HTTPS
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

---

## Step 9: Add SSL Certificate (Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-server-hostname.example.com

# Auto-renewal is configured automatically
```

---

## Managing the Service

```bash
# View logs
sudo journalctl -u monitoring-dashboard -f

# Restart service
sudo systemctl restart monitoring-dashboard

# Stop service
sudo systemctl stop monitoring-dashboard

# Check status
sudo systemctl status monitoring-dashboard
```

---

## Updating the Application

```bash
cd /opt/monitoring-dashboard

# Pull latest changes
sudo -u www-data git pull

# Install any new dependencies
sudo -u www-data npm install

# Apply database migrations
sudo -u www-data npm run db:push

# Rebuild
sudo -u www-data npm run build

# Restart service
sudo systemctl restart monitoring-dashboard
```

---

## Troubleshooting

### Check Application Logs
```bash
sudo journalctl -u monitoring-dashboard -n 100 --no-pager
```

### Check Database Connection
```bash
sudo -u postgres psql -c "SELECT 1" monitoring_dashboard
```

### Test Direct Connection
```bash
curl http://localhost:5000/api/sites
```

### Check Nginx Logs
```bash
sudo tail -f /var/log/nginx/error.log
```

---

## Security Recommendations

1. **Use strong passwords** for database and platform connections
2. **Enable SSL/TLS** using Let's Encrypt
3. **Restrict database access** to localhost only
4. **Use a firewall** (ufw) to limit exposed ports
5. **Keep system updated** with regular `apt update && apt upgrade`
6. **Back up your .env file** securely - it contains sensitive credentials

---

## Adding Platform Connections

Once deployed, you can add platform connections in two ways:

### Option 1: Environment Variables
Edit `/opt/monitoring-dashboard/.env` and add your platform configurations, then restart the service.

### Option 2: Settings UI (Recommended)
Navigate to `http://your-server/settings` in your browser and use the web interface to add, edit, and test platform connections.

---

## Configuring Veeam ONE Integration

Veeam ONE provides backup monitoring across all your VCD sites from a single instance.

### Via Settings UI (Recommended)
1. Navigate to `http://your-server/settings`
2. Scroll to the **Veeam ONE Integration** section
3. Enter your Veeam ONE server details:
   - **API URL**: `https://veeam-one-server.example.com:1239`
   - **Username**: Veeam ONE administrator account
   - **Password**: Account password
   - **Display Name**: Friendly name for the dashboard
   - **Location**: Physical location for reference
4. Click **Test Connection** to verify connectivity
5. Click **Save Configuration** to persist settings
6. Restart the application service to apply changes

### Via Environment Variables
Add the following to your `.env` file:

```bash
# Veeam ONE Configuration
VEEAM_SITES=VEEAM1
VEEAM_VEEAM1_URL=https://veeam-one.example.com:1239
VEEAM_VEEAM1_USERNAME=administrator
VEEAM_VEEAM1_PASSWORD=your_password
VEEAM_VEEAM1_NAME=Veeam ONE Server
VEEAM_VEEAM1_LOCATION=US-East
```

> **Note:** Veeam ONE REST API uses port 1239 by default. Ensure this port is accessible from your dashboard server.

---

## Quick Start for Ubuntu 24.04 LTS

For a fast deployment on a fresh Ubuntu 24.04 LTS server:

```bash
# 1. Install prerequisites
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql postgresql-contrib nginx git

# 2. Setup database
sudo -u postgres psql -c "CREATE USER monitoring WITH PASSWORD 'secure_password';"
sudo -u postgres psql -c "CREATE DATABASE monitoring_dashboard OWNER monitoring;"

# 3. Clone and build
sudo mkdir -p /opt/monitoring-dashboard
sudo chown $USER:$USER /opt/monitoring-dashboard
cd /opt/monitoring-dashboard
git clone https://github.com/wayne108799/infrastructure-monitoring-dashboard.git .

# 4. Configure
echo "DATABASE_URL=postgresql://monitoring:secure_password@localhost:5432/monitoring_dashboard" > .env
npm install
npm run db:push
npm run build

# 5. Start service (see Step 6 above for systemd configuration)
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Ubuntu 24.04 LTS                      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────┐    ┌──────────────────┐    ┌───────────┐  │
│  │  Nginx  │───▶│  Node.js App     │───▶│PostgreSQL │  │
│  │  :80    │    │  :5000           │    │  :5432    │  │
│  └─────────┘    └──────────────────┘    └───────────┘  │
│       │                  │                              │
│       │                  ▼                              │
│       │         ┌──────────────────┐                   │
│       │         │ Platform APIs    │                   │
│       │         │ • VCD :443       │                   │
│       │         │ • CloudStack     │                   │
│       │         │ • Proxmox :8006  │                   │
│       │         │ • Veeam :1239    │                   │
│       │         └──────────────────┘                   │
│       ▼                                                 │
│  Users access via browser                               │
└─────────────────────────────────────────────────────────┘
```
