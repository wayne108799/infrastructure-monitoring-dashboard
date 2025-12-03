# VMware Cloud Director Configuration

## Environment Variables Setup

To connect to your VMware Cloud Director instances, you need to configure environment variables for each site.

### Required Variables

#### Step 1: Define Your Sites
```bash
VCD_SITES=ny,london,singapore
```

#### Step 2: Configure Each Site

For each site listed in `VCD_SITES`, provide the following variables:

```bash
# Site: ny (US-East Primary)
VCD_NY_URL=https://vcd-ny.example.com
VCD_NY_USERNAME=admin
VCD_NY_PASSWORD=your_password_here
VCD_NY_ORG=System
VCD_NY_NAME=US-East Primary
VCD_NY_LOCATION=New York, NY

# Site: london (EU-West Hub)
VCD_LONDON_URL=https://vcd-london.example.com
VCD_LONDON_USERNAME=admin
VCD_LONDON_PASSWORD=your_password_here
VCD_LONDON_ORG=System
VCD_LONDON_NAME=EU-West Hub
VCD_LONDON_LOCATION=London, UK
```

### Environment Variable Format

- **VCD_{SITE}_URL**: Full VCD API endpoint URL (e.g., `https://vcd.example.com`)
- **VCD_{SITE}_USERNAME**: VCD administrator username
- **VCD_{SITE}_PASSWORD**: VCD administrator password
- **VCD_{SITE}_ORG**: Organization name (often `System` for provider admins)
- **VCD_{SITE}_NAME**: Display name for the site in the UI
- **VCD_{SITE}_LOCATION**: Geographic location description

### Using Replit Secrets

1. Open the **Secrets** tab in your Replit workspace (lock icon in sidebar)
2. Click **"Edit as JSON"**
3. Paste your configuration:

```json
{
  "VCD_SITES": "ny,london",
  "VCD_NY_URL": "https://vcd-ny.example.com",
  "VCD_NY_USERNAME": "admin",
  "VCD_NY_PASSWORD": "SecurePassword123!",
  "VCD_NY_ORG": "System",
  "VCD_NY_NAME": "US-East Primary",
  "VCD_NY_LOCATION": "New York, NY",
  "VCD_LONDON_URL": "https://vcd-ldn.example.com",
  "VCD_LONDON_USERNAME": "admin",
  "VCD_LONDON_PASSWORD": "SecurePassword456!",
  "VCD_LONDON_ORG": "System",
  "VCD_LONDON_NAME": "EU-West Hub",
  "VCD_LONDON_LOCATION": "London, UK"
}
```

4. Click **Save**
5. Restart the application

### Testing Connection

Once configured, test the connection via:

```bash
POST /api/sites/{siteId}/test-connection
```

Or check the browser console for connection errors when the dashboard loads.

### Security Notes

- **Never commit credentials to version control**
- Use Replit Secrets for production deployments
- Consider using service accounts with read-only permissions
- Rotate passwords regularly
- Use HTTPS endpoints only

### API Version

This application targets **VMware Cloud Director 10.6** (API version 38.x). It may work with 10.4+ but has not been tested.

### Troubleshooting

**Connection Refused:**
- Verify the VCD_*_URL is accessible from your Replit environment
- Check firewall rules allow outbound HTTPS to your VCD instances

**Authentication Failed:**
- Confirm username format is correct (usually `username@org`)
- Verify password has no trailing spaces
- Check organization name matches exactly

**No Data Displayed:**
- Check browser console for API errors
- Verify the user has permissions to view Organization VDCs
- Test connection using the `/api/sites/{id}/test-connection` endpoint
