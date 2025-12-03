import type { Express } from "express";
import { createServer, type Server } from "http";
import { log } from "./index";
import { platformRegistry, type PlatformType, type SiteSummary } from "./lib/platforms";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize all platform clients from environment
  platformRegistry.initializeFromEnv();

  /**
   * GET /api/sites
   * Get list of all configured sites across all platforms
   */
  app.get('/api/sites', async (req, res) => {
    try {
      const { platform } = req.query;
      
      let sites = platformRegistry.getAllSites();
      
      // Filter by platform if specified
      if (platform && typeof platform === 'string') {
        sites = sites.filter(s => s.platformType === platform);
      }

      const siteList = sites.map(({ id, platformType, info }) => ({
        id: info.id,
        compositeId: id,
        name: info.name,
        location: info.location,
        url: info.url,
        platformType,
        status: info.status,
      }));

      res.json(siteList);
    } catch (error: any) {
      log(`Error fetching sites: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/platforms
   * Get list of available platform types
   */
  app.get('/api/platforms', async (req, res) => {
    try {
      const sites = platformRegistry.getAllSites();
      const platforms = new Set(sites.map(s => s.platformType));
      
      const platformInfo = Array.from(platforms).map(type => ({
        type,
        name: type === 'vcd' ? 'VMware Cloud Director' : 
              type === 'cloudstack' ? 'Apache CloudStack' : 
              type === 'proxmox' ? 'Proxmox VE' : type,
        siteCount: sites.filter(s => s.platformType === type).length,
      }));

      res.json(platformInfo);
    } catch (error: any) {
      log(`Error fetching platforms: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/summary
   * Get aggregated summary for a site (works across all platforms)
   */
  app.get('/api/sites/:siteId/summary', async (req, res) => {
    log(`Received summary request for site: ${req.params.siteId}`, 'routes');
    try {
      const { siteId } = req.params;
      const client = platformRegistry.getClientBySiteId(siteId);

      if (!client) {
        return res.status(404).json({ error: `Site not found: ${siteId}` });
      }

      const summary = await client.getSiteSummary();
      
      // Transform to legacy format for backward compatibility
      res.json({
        totalVdcs: summary.totalTenants,
        totalVms: summary.totalVms,
        runningVms: summary.runningVms,
        cpu: {
          capacity: summary.cpu.capacity,
          allocated: summary.cpu.allocated,
          used: summary.cpu.used,
          reserved: summary.cpu.reserved || 0,
          available: summary.cpu.available,
          units: summary.cpu.units,
        },
        memory: {
          capacity: summary.memory.capacity,
          allocated: summary.memory.allocated,
          used: summary.memory.used,
          reserved: summary.memory.reserved || 0,
          available: summary.memory.available,
          units: summary.memory.units,
        },
        storage: {
          capacity: summary.storage.capacity,
          limit: summary.storage.limit,
          used: summary.storage.used,
          available: summary.storage.available,
          units: summary.storage.units,
        },
        network: summary.network,
        platformType: summary.platformType,
      });
    } catch (error: any) {
      log(`Error fetching summary for site ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/tenants
   * Get all tenant allocations (VDCs, Projects, Nodes) for a site
   */
  app.get('/api/sites/:siteId/tenants', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = platformRegistry.getClientBySiteId(siteId);

      if (!client) {
        return res.status(404).json({ error: `Site not found: ${siteId}` });
      }

      const tenants = await client.getTenantAllocations();
      res.json(tenants);
    } catch (error: any) {
      log(`Error fetching tenants for site ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/vdcs (legacy endpoint - maps to tenants)
   * Backward compatibility for VCD-specific frontend code
   */
  app.get('/api/sites/:siteId/vdcs', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = platformRegistry.getClientBySiteId(siteId);

      if (!client) {
        return res.status(404).json({ error: `Site not found: ${siteId}` });
      }

      const tenants = await client.getTenantAllocations();
      
      // Map to VDC-like structure for backward compatibility
      const vdcs = tenants.map(tenant => ({
        id: tenant.id,
        name: tenant.name,
        description: tenant.description,
        status: tenant.status === 'active' ? 1 : 0,
        computeCapacity: {
          cpu: tenant.cpu,
          memory: tenant.memory,
        },
        storageProfiles: [{
          name: 'Storage',
          limit: tenant.storage.limit,
          used: tenant.storage.used,
        }],
        vmResources: {
          vmCount: tenant.vmCount,
          runningVmCount: tenant.runningVmCount,
        },
        ipAllocation: {
          totalIpCount: tenant.allocatedIps || 0,
        },
      }));

      res.json(vdcs);
    } catch (error: any) {
      log(`Error fetching VDCs for site ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/tenants/:tenantId
   * Get detailed tenant allocation
   */
  app.get('/api/sites/:siteId/tenants/:tenantId', async (req, res) => {
    try {
      const { siteId, tenantId } = req.params;
      const client = platformRegistry.getClientBySiteId(siteId);

      if (!client) {
        return res.status(404).json({ error: `Site not found: ${siteId}` });
      }

      const tenant = await client.getTenantAllocation(tenantId);
      
      if (!tenant) {
        return res.status(404).json({ error: `Tenant not found: ${tenantId}` });
      }

      res.json(tenant);
    } catch (error: any) {
      log(`Error fetching tenant ${req.params.tenantId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/sites/:siteId/test-connection
   * Test connection to a site
   */
  app.post('/api/sites/:siteId/test-connection', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = platformRegistry.getClientBySiteId(siteId);

      if (!client) {
        return res.status(404).json({ error: `Site not found: ${siteId}` });
      }

      const success = await client.testConnection();
      res.json({ success, message: success ? 'Connection successful' : 'Connection failed' });
    } catch (error: any) {
      log(`Connection test failed for ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/summary
   * Get aggregated summary across all sites
   */
  app.get('/api/summary', async (req, res) => {
    try {
      const { platform } = req.query;
      
      let sites = platformRegistry.getAllSites();
      
      // Filter by platform if specified
      if (platform && typeof platform === 'string') {
        sites = sites.filter(s => s.platformType === platform);
      }

      const summaries: (SiteSummary & { siteName: string })[] = [];
      
      for (const site of sites) {
        try {
          const client = platformRegistry.getClient(site.id);
          if (client) {
            const summary = await client.getSiteSummary();
            summaries.push({ ...summary, siteName: site.info.name });
          }
        } catch (error: any) {
          log(`Error fetching summary for ${site.id}: ${error.message}`, 'routes');
        }
      }

      // Aggregate totals
      const totals = {
        totalSites: summaries.length,
        totalTenants: summaries.reduce((sum, s) => sum + s.totalTenants, 0),
        totalVms: summaries.reduce((sum, s) => sum + s.totalVms, 0),
        runningVms: summaries.reduce((sum, s) => sum + s.runningVms, 0),
        cpu: {
          capacity: summaries.reduce((sum, s) => sum + s.cpu.capacity, 0),
          allocated: summaries.reduce((sum, s) => sum + s.cpu.allocated, 0),
          used: summaries.reduce((sum, s) => sum + s.cpu.used, 0),
          available: summaries.reduce((sum, s) => sum + s.cpu.available, 0),
          units: 'MHz',
        },
        memory: {
          capacity: summaries.reduce((sum, s) => sum + s.memory.capacity, 0),
          allocated: summaries.reduce((sum, s) => sum + s.memory.allocated, 0),
          used: summaries.reduce((sum, s) => sum + s.memory.used, 0),
          available: summaries.reduce((sum, s) => sum + s.memory.available, 0),
          units: 'MB',
        },
        storage: {
          capacity: summaries.reduce((sum, s) => sum + s.storage.capacity, 0),
          used: summaries.reduce((sum, s) => sum + s.storage.used, 0),
          available: summaries.reduce((sum, s) => sum + s.storage.available, 0),
          units: 'MB',
        },
        network: {
          totalIps: summaries.reduce((sum, s) => sum + s.network.totalIps, 0),
          allocatedIps: summaries.reduce((sum, s) => sum + s.network.allocatedIps, 0),
          usedIps: summaries.reduce((sum, s) => sum + s.network.usedIps, 0),
          freeIps: summaries.reduce((sum, s) => sum + s.network.freeIps, 0),
        },
        byPlatform: {} as Record<string, any>,
      };

      // Group by platform
      for (const summary of summaries) {
        if (!totals.byPlatform[summary.platformType]) {
          totals.byPlatform[summary.platformType] = {
            siteCount: 0,
            totalVms: 0,
            runningVms: 0,
          };
        }
        totals.byPlatform[summary.platformType].siteCount++;
        totals.byPlatform[summary.platformType].totalVms += summary.totalVms;
        totals.byPlatform[summary.platformType].runningVms += summary.runningVms;
      }

      res.json({ totals, sites: summaries });
    } catch (error: any) {
      log(`Error fetching aggregated summary: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
