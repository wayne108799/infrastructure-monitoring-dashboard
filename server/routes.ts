import type { Express } from "express";
import { createServer, type Server } from "http";
import { VcdClient, type VcdConfig } from "./lib/vcdClient";
import { log } from "./index";

// VCD client instances (one per configured site)
const vcdClients: Map<string, VcdClient> = new Map();

// Initialize VCD clients from environment variables
function initializeVcdClients() {
  // Support multiple VCD sites via environment variables
  // Format: VCD_SITES=site1,site2,site3
  // For each site: VCD_SITE1_URL, VCD_SITE1_USERNAME, etc.
  
  const sitesEnv = process.env.VCD_SITES || '';
  const siteIds = sitesEnv.split(',').map(s => s.trim()).filter(Boolean);

  if (siteIds.length === 0) {
    log('No VCD sites configured. Set VCD_SITES environment variable.', 'routes');
    return;
  }

  for (const siteId of siteIds) {
    const url = process.env[`VCD_${siteId.toUpperCase()}_URL`];
    const username = process.env[`VCD_${siteId.toUpperCase()}_USERNAME`];
    const password = process.env[`VCD_${siteId.toUpperCase()}_PASSWORD`];
    const org = process.env[`VCD_${siteId.toUpperCase()}_ORG`];

    if (!url || !username || !password || !org) {
      log(`Incomplete configuration for VCD site: ${siteId}. Skipping.`, 'routes');
      continue;
    }

    const config: VcdConfig = { url, username, password, org };
    vcdClients.set(siteId, new VcdClient(config));
    log(`Initialized VCD client for site: ${siteId}`, 'routes');
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize VCD clients
  initializeVcdClients();

  /**
   * GET /api/sites
   * Get list of configured VCD sites
   */
  app.get('/api/sites', async (req, res) => {
    try {
      const sites = Array.from(vcdClients.keys()).map(siteId => {
        const url = process.env[`VCD_${siteId.toUpperCase()}_URL`] || '';
        const name = process.env[`VCD_${siteId.toUpperCase()}_NAME`] || siteId;
        const location = process.env[`VCD_${siteId.toUpperCase()}_LOCATION`] || 'Unknown';
        
        return {
          id: siteId,
          name,
          location,
          url,
          status: 'online' // We'll assume online; could ping /api/versions to verify
        };
      });

      res.json(sites);
    } catch (error: any) {
      log(`Error fetching sites: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/vdcs
   * Get all Organization VDCs for a site
   */
  app.get('/api/sites/:siteId/vdcs', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = vcdClients.get(siteId);

      if (!client) {
        return res.status(404).json({ error: `VCD site not found: ${siteId}` });
      }

      const vdcs = await client.getOrgVdcs();
      
      // Fetch comprehensive data for each VDC (in parallel)
      const comprehensiveVdcs = await Promise.all(
        vdcs.map(async (vdc) => {
          try {
            return await client.getVdcComprehensive(vdc.id);
          } catch (error: any) {
            log(`Error fetching comprehensive data for VDC ${vdc.id}: ${error.message}`, 'routes');
            // Return basic VDC data if comprehensive fetch fails
            return vdc;
          }
        })
      );

      res.json(comprehensiveVdcs);
    } catch (error: any) {
      log(`Error fetching VDCs for site ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/vdcs/:vdcId
   * Get detailed information for a specific VDC
   */
  app.get('/api/sites/:siteId/vdcs/:vdcId', async (req, res) => {
    try {
      const { siteId, vdcId } = req.params;
      const client = vcdClients.get(siteId);

      if (!client) {
        return res.status(404).json({ error: `VCD site not found: ${siteId}` });
      }

      const vdcData = await client.getVdcComprehensive(vdcId);
      res.json(vdcData);
    } catch (error: any) {
      log(`Error fetching VDC ${req.params.vdcId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/sites/:siteId/test-connection
   * Test connection to a VCD site
   */
  app.post('/api/sites/:siteId/test-connection', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = vcdClients.get(siteId);

      if (!client) {
        return res.status(404).json({ error: `VCD site not found: ${siteId}` });
      }

      await client.authenticate();
      res.json({ success: true, message: 'Connection successful' });
    } catch (error: any) {
      log(`Connection test failed for ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/summary
   * Get aggregated totals for a VCD site including Provider VDC capacity
   */
  app.get('/api/sites/:siteId/summary', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = vcdClients.get(siteId);

      if (!client) {
        return res.status(404).json({ error: `VCD site not found: ${siteId}` });
      }

      // Fetch VDCs and Provider capacity in parallel
      const [vdcs, providerCapacity] = await Promise.all([
        client.getOrgVdcs(),
        client.getProviderCapacity()
      ]);
      
      // Fetch comprehensive data for each VDC (in parallel)
      const comprehensiveVdcs = await Promise.all(
        vdcs.map(async (vdc) => {
          try {
            return await client.getVdcComprehensive(vdc.id);
          } catch (error: any) {
            return vdc;
          }
        })
      );

      // Aggregate totals from Org VDCs (what's allocated to tenants)
      const summary = {
        totalVdcs: comprehensiveVdcs.length,
        totalVms: 0,
        runningVms: 0,
        cpu: {
          capacity: providerCapacity.cpu.capacity,
          allocated: 0,
          used: 0,
          reserved: 0,
          available: 0,
          units: 'MHz'
        },
        memory: {
          capacity: providerCapacity.memory.capacity,
          allocated: 0,
          used: 0,
          reserved: 0,
          available: 0,
          units: 'MB'
        },
        storage: {
          capacity: providerCapacity.storage.capacity,
          limit: 0,
          used: 0,
          available: 0,
          units: 'MB'
        },
        network: {
          totalIps: 0,
          usedIps: 0,
          freeIps: 0
        }
      };

      for (const vdc of comprehensiveVdcs) {
        // Aggregate VM counts
        if (vdc.vmResources) {
          summary.totalVms += vdc.vmResources.vmCount || 0;
          summary.runningVms += vdc.vmResources.runningVmCount || 0;
        }
        
        // Aggregate compute capacity
        if (vdc.computeCapacity) {
          summary.cpu.allocated += vdc.computeCapacity.cpu?.allocated || 0;
          summary.cpu.used += vdc.computeCapacity.cpu?.used || 0;
          summary.cpu.reserved += vdc.computeCapacity.cpu?.reserved || 0;
          summary.memory.allocated += vdc.computeCapacity.memory?.allocated || 0;
          summary.memory.used += vdc.computeCapacity.memory?.used || 0;
          summary.memory.reserved += vdc.computeCapacity.memory?.reserved || 0;
        }
        
        // Aggregate storage
        if (vdc.storageProfiles && Array.isArray(vdc.storageProfiles)) {
          for (const profile of vdc.storageProfiles) {
            summary.storage.limit += profile.limit || 0;
            summary.storage.used += profile.used || 0;
          }
        }
        
        // Aggregate network IPs
        if (vdc.network?.allocatedIps) {
          summary.network.totalIps += vdc.network.allocatedIps.totalIpCount || 0;
          summary.network.usedIps += vdc.network.allocatedIps.usedIpCount || 0;
          summary.network.freeIps += vdc.network.allocatedIps.freeIpCount || 0;
        }
      }

      // Calculate available = capacity - allocated (or capacity - limit for storage)
      // If provider capacity is 0, use allocated as the capacity (PVDC query might have failed)
      if (summary.cpu.capacity > 0) {
        summary.cpu.available = summary.cpu.capacity - summary.cpu.allocated;
      } else {
        summary.cpu.capacity = summary.cpu.allocated;
        summary.cpu.available = summary.cpu.allocated - summary.cpu.used;
      }
      
      if (summary.memory.capacity > 0) {
        summary.memory.available = summary.memory.capacity - summary.memory.allocated;
      } else {
        summary.memory.capacity = summary.memory.allocated;
        summary.memory.available = summary.memory.allocated - summary.memory.used;
      }
      
      if (summary.storage.capacity > 0) {
        summary.storage.available = summary.storage.capacity - summary.storage.limit;
      } else {
        summary.storage.capacity = summary.storage.limit;
        summary.storage.available = summary.storage.limit - summary.storage.used;
      }

      res.json(summary);
    } catch (error: any) {
      log(`Error fetching summary for site ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
