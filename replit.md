# Multi-Platform Infrastructure Monitoring Dashboard

## Overview
A unified monitoring dashboard to track resource usage across multiple virtualization platforms:
- **VMware Cloud Director (VCD)** - Version 10.6+
- **Apache CloudStack** - REST API with signature-based auth
- **Proxmox VE** - HTTPS API with ticket auth

The dashboard displays resource availability, usage, and allocation metrics for:
- Compute (CPU/Memory)
- Storage
- Public IP addresses

## Architecture

### Backend (`server/`)
- **Platform Clients**: Unified `PlatformClient` interface with platform-specific implementations
  - `server/lib/platforms/types.ts` - Shared types and interfaces
  - `server/lib/platforms/vcdAdapter.ts` - VCD adapter wrapping VcdClient
  - `server/lib/platforms/cloudstackClient.ts` - CloudStack with HMAC-SHA1 signature auth
  - `server/lib/platforms/proxmoxClient.ts` - Proxmox with ticket-based auth
  - `server/lib/platforms/index.ts` - Platform registry and factory
- **Routes**: `server/routes.ts` - REST API endpoints for all platforms
  - `server/lib/platforms/veeamClient.ts` - Veeam ONE with OAuth 2.0 token auth
  - `server/lib/platforms/vspcClient.ts` - VSPC (Veeam Service Provider Console) with OAuth 2.0 token auth

### Frontend (`client/`)
- **Dashboard**: `client/src/pages/dashboard.tsx` - Overview with pie charts per site
- **Details**: `client/src/pages/details.tsx` - Tenant allocation grid
- **API Client**: `client/src/lib/api.ts` - Backend API integration

## Configuration

### VCD Sites
```
VCD_SITES=SITE1,SITE2
VCD_SITE1_URL=vcd.example.com
VCD_SITE1_USERNAME=administrator
VCD_SITE1_PASSWORD=secret
VCD_SITE1_ORG=System
VCD_SITE1_NAME=Site 1
VCD_SITE1_LOCATION=US-East
```

### CloudStack Sites
```
CLOUDSTACK_SITES=CS1,CS2
CLOUDSTACK_CS1_URL=https://cloudstack.example.com
CLOUDSTACK_CS1_API_KEY=your-api-key
CLOUDSTACK_CS1_SECRET_KEY=your-secret-key
CLOUDSTACK_CS1_NAME=CloudStack Site 1
CLOUDSTACK_CS1_LOCATION=US-West
```

### Proxmox Sites
```
PROXMOX_SITES=PVE1
PROXMOX_PVE1_URL=https://pve.example.com:8006
PROXMOX_PVE1_USERNAME=root
PROXMOX_PVE1_PASSWORD=secret
PROXMOX_PVE1_REALM=pam
PROXMOX_PVE1_NAME=Proxmox Cluster 1
PROXMOX_PVE1_LOCATION=EU-Central
```

### Veeam ONE Sites
```
VEEAM_SITES=VEEAM1
VEEAM_VEEAM1_URL=https://veeam-one.example.com:1239
VEEAM_VEEAM1_USERNAME=administrator
VEEAM_VEEAM1_PASSWORD=secret
VEEAM_VEEAM1_NAME=Veeam ONE Server
VEEAM_VEEAM1_LOCATION=US-East
```

## Storage Capacity Configuration
Each site can have custom usable storage capacity configured per tier:
- Settings page allows viewing discovered storage tiers from VCD
- Set custom "usable capacity" values that override platform-reported values
- Dashboard uses configured capacity when calculating usage percentages
- Configured tiers display with an asterisk (*) indicator
- API returns both platform capacity and configured overrides

## API Endpoints

- `GET /api/platforms` - List available platform types
- `GET /api/sites` - List all configured sites (supports `?platform=vcd|cloudstack|proxmox` filter)
- `GET /api/sites/:siteId/summary` - Get site resource summary
- `GET /api/sites/:siteId/tenants` - Get tenant allocations (VDCs, Projects, Nodes)
- `GET /api/sites/:siteId/vdcs` - Legacy VDC endpoint (backward compatible)
- `GET /api/summary` - Aggregated summary across all sites
- `POST /api/sites/:siteId/test-connection` - Test site connectivity
- `GET /api/commit-levels` - List all tenant commit levels (optional `?siteId=` filter)
- `GET /api/commit-levels/:siteId/:tenantId` - Get specific tenant commit level
- `POST /api/commit-levels` - Create/update tenant commit level
- `DELETE /api/commit-levels/:siteId/:tenantId` - Delete tenant commit level
- `GET /api/export/tenants` - Export all tenants as CSV (includes commit levels)
- `GET /api/report/high-water-mark` - Get high water mark usage for billing (params: `year`, `month`)
- `GET /api/report/available-months` - List months with polling data for billing reports
- `GET /api/report/overages` - Get overage data over time (params: `startDate`, `endDate`, `siteId`, `tenantId`)
- `GET /api/veeam/summary` - Get Veeam ONE backup summary across all sites
- `GET /api/veeam/sites/:siteId` - Get Veeam ONE backup details for a specific site
- `GET /api/veeam/backup-by-org` - Get backup metrics grouped by organization name (for tenant matching)
- `POST /api/vspc/:siteId/test-connection` - Test VSPC connection for a VCD site
- `GET /api/vspc/:siteId/summary` - Get VSPC backup summary for a VCD site
- `GET /api/vspc/:siteId/backup-by-org` - Get VSPC backup metrics by organization ID

## Minimum Commit Levels
On the Details page, each tenant card has a "Set Commit" button to define minimum resource commitments:
- **vCPU Count** and **CPU Speed (GHz)**
- **RAM (GB)**
- **Storage per tier**: HPS, SPS, VVol, Other (in GB)
- **Public IPs**
- **Notes**

These values are stored in the database and included in CSV exports for capacity planning and reporting.

## High Water Mark Billing
The Report page displays **high water mark** usage for billing purposes:
- Shows maximum resource usage recorded during the selected billing month
- Based on polling data captured every 4 hours (stored in `tenantPollSnapshots` table)
- Month selector allows viewing historical billing periods
- Metrics include: vCPU, RAM, storage per tier, and public IPs
- Storage tier names are normalized (lowercase) to prevent duplicate entries from case variations
- Data retained for 30 days for billing reconciliation

## Overages Tracking
The Overages page at `/overages` provides time-series visualization of resource usage vs commit levels:
- **Time-series graphs**: Line charts showing vCPU and RAM usage over time
- **Commit level comparison**: Dashed lines show commit levels, solid lines show actual usage
- **Overage detection**: Highlights when usage exceeds committed resources
- **Filtering**: Filter by date range (7/14/30 days), site, or specific tenant
- **Summary cards**: Count of tenants in overage, CPU overages, RAM overages
- **Detail breakdown**: Per-tenant overage details with max overage values
- Data sourced from polling snapshots captured every 4 hours

## Recent Changes
- **VSPC Integration**: Added Veeam Service Provider Console integration for VCD sites
  - VSPC configuration fields added to VCD site settings (URL, username, password)
  - Details page displays backup metrics per organization using org ID matching
  - Falls back to name matching when org ID is not available
  - Endpoints: `POST /api/vspc/:siteId/test-connection`, `GET /api/vspc/:siteId/backup-by-org`
  - Password masking prevents clearing existing credentials during edit
- **Overages Page**: New time-series visualization for tracking resource overages at `/overages`
  - Line charts for vCPU and RAM usage vs commit levels
  - Filter by date range, site, or tenant
  - Summary cards showing overage counts
  - Per-tenant overage details with max values
  - Endpoint: `GET /api/report/overages`
- **High Water Mark Billing**: Report page now shows maximum monthly usage for billing
  - Month selector to view any historical period with polling data
  - Displays max vCPU, RAM, storage, and IP usage per tenant
  - API endpoints: `/api/report/high-water-mark`, `/api/report/available-months`
  - Input validation on year/month parameters with helpful error messages
  - Empty state handling when no polling data exists
- **Per-Tenant Backup Metrics**: Details page now shows backup status per organization
  - Protected VMs count, backup storage used, protection coverage percentage
  - Metrics matched from Veeam ONE to VCD organizations using normalized name matching
  - Only displays when Veeam is configured and has data for the organization
  - Endpoint: `GET /api/veeam/backup-by-org`
- **Veeam ONE UI Configuration**: Settings page now includes dedicated form to configure Veeam ONE
  - Enter URL, username, password, display name, and location
  - Test connection button validates connectivity before saving
  - Configuration stored in database (globalConfig table)
  - Endpoints: `GET/POST /api/veeam/config`, `POST /api/veeam/config/test`
- **Deployment Documentation**: Updated DEPLOYMENT.md for Ubuntu 24.04 LTS
  - Quick start guide for fresh installations
  - Architecture diagram with all platform connections
  - Veeam ONE configuration instructions
- **Provision Page**: New auto-provisioning feature at `/provision` to create VCD resources
  - Creates Organization, Org VDC, Edge Gateway, and SNAT rules in a single workflow
  - Form-based interface for selecting target VCD site and configuring resources
  - Automatic SNAT rule creation for outbound internet access
  - Endpoints: `GET /api/sites/:siteId/provisioning-resources`, `POST /api/sites/:siteId/provision`
- **Report Page**: Now shows "used" resource values instead of "allocated" limits
  - vCPU calculated from used MHz / 2800
  - RAM and storage show actual consumption by running VMs
- **Storage Capacity Fix**: Now correctly retrieves Provider VDC storage capacity from vCenter
  - Reads `capacityTotal` from Provider VDC storage profiles (in KB, converted to MB)
  - Shows actual physical storage capacity vs allocated limits (can show overcommitment)
  - Storage breakdown: capacity (physical), limit (allocated), used, available
- Added Settings page for managing platform connections via UI (`/settings`)
- Added database-backed site configuration with CRUD API (`/api/config/sites`)
- Added multi-platform support for VCD, CloudStack, and Proxmox
- Implemented unified PlatformClient interface for provider-agnostic metrics
- Added platform filtering on dashboard
- Added platform badges to site displays
- Converted dashboard graphs to pie/donut charts
- Created separate Overview (graphs) and Details (tenant grid) pages

## Storage Metrics (VCD)
The storage capacity shown on the dashboard comes from Provider VDC storage profiles:
- **Capacity**: Physical storage from vCenter (Provider VDC storage profiles `capacityTotal`)
- **Limit**: Sum of all Org VDC storage allocations (can exceed capacity if overcommitted)
- **Used**: Actual storage consumed by tenant VMs and objects
- **Available**: Capacity minus Used (physical availability)
