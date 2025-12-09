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

## Minimum Commit Levels
On the Details page, each tenant card has a "Set Commit" button to define minimum resource commitments:
- **vCPU Count** and **CPU Speed (GHz)**
- **RAM (GB)**
- **Storage per tier**: HPS, SPS, VVol, Other (in GB)
- **Public IPs**
- **Notes**

These values are stored in the database and included in CSV exports for capacity planning and reporting.

## Recent Changes
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
