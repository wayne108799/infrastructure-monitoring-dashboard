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

  return httpServer;
}
