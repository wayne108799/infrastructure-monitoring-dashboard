import type { Express } from "express";
import { createServer, type Server } from "http";
import { log } from "./index";
import { platformRegistry, type PlatformType, type SiteSummary, VeeamOneClient } from "./lib/platforms";
import { storage } from "./storage";
import { insertPlatformSiteSchema, updatePlatformSiteSchema, insertTenantCommitLevelSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Initialize all platform clients from environment
  platformRegistry.initializeFromEnv();
  
  // Also load sites from database
  try {
    const dbSites = await storage.getAllPlatformSites();
    if (dbSites.length > 0) {
      await platformRegistry.initializeFromDatabase(dbSites);
    }
  } catch (error) {
    log(`Warning: Could not load sites from database: ${error}`, 'routes');
  }
  
  // Load Veeam ONE config from globalConfig
  try {
    log(`Attempting to load Veeam ONE config from database...`, 'routes');
    const veeamConfigJson = await storage.getGlobalConfig('veeam_config');
    log(`Veeam config from DB: ${veeamConfigJson ? 'found' : 'not found'}`, 'routes');
    if (veeamConfigJson) {
      const veeamConfig = JSON.parse(veeamConfigJson);
      log(`Parsed Veeam config: url=${veeamConfig.url}, hasUsername=${!!veeamConfig.username}, hasPassword=${!!veeamConfig.password}`, 'routes');
      if (veeamConfig.url && veeamConfig.username && veeamConfig.password) {
        platformRegistry.addSiteFromConfig({
          siteId: 'VEEAM_GLOBAL',
          platformType: 'veeam',
          name: veeamConfig.name || 'Veeam ONE',
          location: veeamConfig.location || '',
          url: veeamConfig.url,
          username: veeamConfig.username,
          password: veeamConfig.password,
        });
        log(`Loaded Veeam ONE configuration from database`, 'routes');
      } else {
        log(`Veeam config incomplete - missing required fields`, 'routes');
      }
    }
  } catch (error: any) {
    log(`Warning: Could not load Veeam config: ${error.message}`, 'routes');
  }

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
              type === 'proxmox' ? 'Proxmox VE' : 
              type === 'veeam' ? 'Veeam ONE' : type,
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
        storageTiers: summary.storageTiers,
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
        orgName: tenant.orgName,
        orgFullName: tenant.orgFullName,
        allocationType: tenant.allocationType,
        description: tenant.description,
        status: tenant.status === 'active' ? 1 : 0,
        computeCapacity: {
          cpu: tenant.cpu,
          memory: tenant.memory,
        },
        storageProfiles: tenant.storageTiers && tenant.storageTiers.length > 0 
          ? tenant.storageTiers.map(tier => ({
              id: tier.name,
              name: tier.name,
              limit: tier.limit,
              used: tier.used,
            }))
          : [{
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

  /**
   * GET /api/veeam/config
   * Get Veeam ONE configuration
   */
  app.get('/api/veeam/config', async (req, res) => {
    try {
      const configJson = await storage.getGlobalConfig('veeam_config');
      if (configJson) {
        res.json(JSON.parse(configJson));
      } else {
        res.json({
          url: '',
          username: '',
          password: '',
          name: 'Veeam ONE',
          location: '',
          isEnabled: false,
        });
      }
    } catch (error: any) {
      log(`Error fetching Veeam config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/veeam/config
   * Save Veeam ONE configuration
   */
  app.post('/api/veeam/config', async (req, res) => {
    try {
      const { url, username, password, name, location, isEnabled } = req.body;
      const config = { url, username, password, name, location, isEnabled };
      await storage.setGlobalConfig('veeam_config', JSON.stringify(config));
      
      // Note: Veeam client will be initialized on next server restart
      // For immediate effect, a server restart is required after saving config
      log(`Veeam config saved. Restart server to apply changes.`, 'routes');
      
      res.json({ success: true, config });
    } catch (error: any) {
      log(`Error saving Veeam config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/veeam/test-connection
   * Test Veeam ONE connection
   */
  app.post('/api/veeam/test-connection', async (req, res) => {
    try {
      const { url, username, password } = req.body;
      
      if (!url || !username || !password) {
        return res.status(400).json({ success: false, error: 'URL, username, and password are required' });
      }

      const testClient = new VeeamOneClient({
        id: 'test',
        url,
        username,
        password,
        name: 'Test',
        location: '',
      });
      
      const result = await testClient.testConnectionWithError();
      
      if (result.success) {
        res.json({ success: true, message: 'Successfully connected to Veeam ONE' });
      } else {
        res.json({ success: false, error: result.error || 'Could not connect to Veeam ONE' });
      }
    } catch (error: any) {
      log(`Error testing Veeam connection: ${error.message}`, 'routes');
      res.json({ success: false, error: `Connection failed: ${error.message}` });
    }
  });

  /**
   * GET /api/veeam/summary
   * Get Veeam ONE backup summary across all Veeam sites
   */
  app.get('/api/veeam/summary', async (req, res) => {
    try {
      const veeamClients = platformRegistry.getClientsByType('veeam');
      
      if (veeamClients.length === 0) {
        return res.json({
          configured: false,
          message: 'No Veeam ONE sites configured',
          sites: [],
          totals: {
            protectedVmCount: 0,
            unprotectedVmCount: 0,
            totalVmCount: 0,
            protectionPercentage: 0,
            repositoryCapacityGB: 0,
            repositoryUsedGB: 0,
            repositoryFreeGB: 0,
          },
        });
      }

      const summaries = [];
      
      for (const client of veeamClients) {
        try {
          const veeamClient = client as VeeamOneClient;
          const summary = await veeamClient.getVeeamSummary();
          const siteInfo = client.getSiteInfo();
          summaries.push({
            ...summary,
            siteId: siteInfo.id,
            siteName: siteInfo.name,
            siteLocation: siteInfo.location,
          });
        } catch (error: any) {
          log(`Error fetching Veeam summary for ${client.getSiteInfo().id}: ${error.message}`, 'routes');
        }
      }

      const totals = {
        protectedVmCount: summaries.reduce((sum, s) => sum + s.backup.protectedVmCount, 0),
        unprotectedVmCount: summaries.reduce((sum, s) => sum + s.backup.unprotectedVmCount, 0),
        totalVmCount: summaries.reduce((sum, s) => sum + s.backup.totalVmCount, 0),
        protectionPercentage: 0,
        repositoryCapacityGB: summaries.reduce((sum, s) => sum + s.totalRepositoryCapacityGB, 0),
        repositoryUsedGB: summaries.reduce((sum, s) => sum + s.totalRepositoryUsedGB, 0),
        repositoryFreeGB: summaries.reduce((sum, s) => sum + s.totalRepositoryFreeGB, 0),
      };

      if (totals.totalVmCount > 0) {
        totals.protectionPercentage = Math.round((totals.protectedVmCount / totals.totalVmCount) * 100);
      }

      res.json({
        configured: true,
        sites: summaries,
        totals,
      });
    } catch (error: any) {
      log(`Error fetching Veeam summary: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/veeam/sites/:siteId
   * Get Veeam ONE backup details for a specific site
   */
  app.get('/api/veeam/sites/:siteId', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = platformRegistry.getClient(`veeam:${siteId}`) || platformRegistry.getClientBySiteId(siteId);

      if (!client || client.getPlatformType() !== 'veeam') {
        return res.status(404).json({ error: `Veeam site not found: ${siteId}` });
      }

      const veeamClient = client as VeeamOneClient;
      const summary = await veeamClient.getVeeamSummary();
      const siteInfo = client.getSiteInfo();

      res.json({
        ...summary,
        siteId: siteInfo.id,
        siteName: siteInfo.name,
        siteLocation: siteInfo.location,
      });
    } catch (error: any) {
      log(`Error fetching Veeam details for ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/veeam/backup-by-org
   * Get backup metrics by matching VCD VMs to Veeam protected VMs
   */
  app.get('/api/veeam/backup-by-org', async (req, res) => {
    try {
      const allClients = platformRegistry.getAllClients();
      const veeamClients: VeeamOneClient[] = [];
      const vcdClients: Array<{ id: string; client: any }> = [];
      
      for (const [id, client] of Array.from(allClients.entries())) {
        if (client.getPlatformType() === 'veeam') {
          veeamClients.push(client as VeeamOneClient);
        } else if (client.getPlatformType() === 'vcd') {
          vcdClients.push({ id, client });
        }
      }

      if (veeamClients.length === 0) {
        return res.json({ configured: false, organizations: {} });
      }

      // Get all protected VM names from Veeam
      const protectedVmNames = new Set<string>();
      for (const veeamClient of veeamClients) {
        try {
          const names = await veeamClient.getProtectedVMNames();
          for (const name of Array.from(names)) {
            protectedVmNames.add(name);
          }
        } catch (error: any) {
          log(`Error fetching Veeam protected VMs: ${error.message}`, 'routes');
        }
      }

      log(`Total unique protected VM names from Veeam: ${protectedVmNames.size}`, 'routes');

      // For each VCD site, get VMs per org and match with Veeam
      // Key by orgName (lowercase) to aggregate multiple VDCs per org
      const orgMetrics: Record<string, { protectedVmCount: number; totalVmCount: number; backupSizeGB: number; vdcCount: number }> = {};
      let totalVmsChecked = 0;
      let totalVmsProtected = 0;

      for (const { id: siteId, client } of vcdClients) {
        try {
          const tenants = await client.getTenantAllocations();
          log(`Processing ${tenants.length} VDCs from site ${siteId} for backup matching`, 'routes');
          
          for (const tenant of tenants) {
            // Use orgName (lowercase) as key to aggregate VDCs from same org
            const orgKey = (tenant.orgName || tenant.id).toLowerCase();
            
            if (!orgMetrics[orgKey]) {
              orgMetrics[orgKey] = { protectedVmCount: 0, totalVmCount: 0, backupSizeGB: 0, vdcCount: 0 };
            }
            orgMetrics[orgKey].vdcCount++;
            
            // Try to get actual VM names for this VDC to match with Veeam
            try {
              const vdcVms = await client.getVmsForVdc(tenant.id);
              orgMetrics[orgKey].totalVmCount += vdcVms.length;
              totalVmsChecked += vdcVms.length;
              
              for (const vm of vdcVms) {
                const vmName = (vm.name || '').toLowerCase();
                if (vmName && protectedVmNames.has(vmName)) {
                  orgMetrics[orgKey].protectedVmCount++;
                  totalVmsProtected++;
                }
              }
            } catch (vmError: any) {
              // Fallback to VM count from tenant allocation
              const fallbackCount = tenant.vmCount || 0;
              orgMetrics[orgKey].totalVmCount += fallbackCount;
              log(`Could not fetch VMs for VDC ${tenant.id}, using count: ${fallbackCount}`, 'routes');
            }
          }
        } catch (error: any) {
          log(`Error getting VCD tenants for backup matching: ${error.message}`, 'routes');
        }
      }

      // Log summary
      const orgsWithBackups = Object.entries(orgMetrics).filter(([, m]) => m.protectedVmCount > 0);
      log(`Backup matching: ${totalVmsChecked} VMs checked, ${totalVmsProtected} protected, ${orgsWithBackups.length}/${Object.keys(orgMetrics).length} orgs with backups`, 'routes');

      res.json({
        configured: true,
        organizations: orgMetrics,
      });
    } catch (error: any) {
      log(`Error fetching backup by org: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/commit-levels
   * Get all tenant commit levels
   */
  app.get('/api/commit-levels', async (req, res) => {
    try {
      const { siteId } = req.query;
      let levels;
      if (siteId && typeof siteId === 'string') {
        levels = await storage.getCommitLevelsBySite(siteId);
      } else {
        levels = await storage.getAllCommitLevels();
      }
      res.json(levels);
    } catch (error: any) {
      log(`Error fetching commit levels: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/commit-levels/:siteId/:tenantId
   * Get a specific tenant's commit level
   */
  app.get('/api/commit-levels/:siteId/:tenantId', async (req, res) => {
    try {
      const { siteId, tenantId } = req.params;
      const level = await storage.getCommitLevel(siteId, tenantId);
      if (level) {
        res.json(level);
      } else {
        res.status(404).json({ error: 'Commit level not found' });
      }
    } catch (error: any) {
      log(`Error fetching commit level: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/commit-levels
   * Create or update a tenant commit level
   */
  app.post('/api/commit-levels', async (req, res) => {
    try {
      // Validate request body
      const parsed = insertTenantCommitLevelSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid commit level data', details: parsed.error.errors });
      }
      
      // Ensure required fields are present
      if (!parsed.data.siteId || !parsed.data.tenantId || !parsed.data.tenantName) {
        return res.status(400).json({ error: 'siteId, tenantId, and tenantName are required' });
      }
      
      const level = await storage.upsertCommitLevel(parsed.data);
      res.json(level);
    } catch (error: any) {
      log(`Error saving commit level: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/commit-levels/:siteId/:tenantId
   * Delete a tenant commit level
   */
  app.delete('/api/commit-levels/:siteId/:tenantId', async (req, res) => {
    try {
      const { siteId, tenantId } = req.params;
      await storage.deleteCommitLevel(siteId, tenantId);
      res.json({ success: true });
    } catch (error: any) {
      log(`Error deleting commit level: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/export/tenants
   * Export all tenant allocations as CSV
   */
  app.get('/api/export/tenants', async (req, res) => {
    try {
      const { format = 'csv' } = req.query;
      const sites = platformRegistry.getAllSites();
      
      // Get all commit levels for enrichment
      const allCommitLevels = await storage.getAllCommitLevels();
      const commitLevelMap = new Map<string, typeof allCommitLevels[0]>();
      for (const level of allCommitLevels) {
        commitLevelMap.set(`${level.siteId}:${level.tenantId}`, level);
      }
      
      interface ExportRow {
        timestamp: string;
        siteId: string;
        site: string;
        siteLocation: string;
        platform: string;
        tenantId: string;
        tenant: string;
        businessId: string;
        businessName: string;
        status: string;
        vmCount: number;
        runningVmCount: number;
        cpuAllocatedMHz: number;
        cpuUsedMHz: number;
        ramAllocatedMB: number;
        ramUsedMB: number;
        storageTotalMB: number;
        storageUsedMB: number;
        storageTier: string;
        tierLimitMB: number;
        tierUsedMB: number;
        allocatedIps: number;
        commitVcpu: string;
        commitGhz: string;
        commitRamGB: string;
        commitHpsGB: string;
        commitSpsGB: string;
        commitVvolGB: string;
        commitOtherGB: string;
        commitIps: string;
        commitNotes: string;
      }

      const rows: ExportRow[] = [];
      const timestamp = new Date().toISOString();

      for (const site of sites) {
        try {
          const client = platformRegistry.getClient(site.id);
          if (!client) continue;

          const tenants = await client.getTenantAllocations();
          
          for (const tenant of tenants) {
            // Look up commit level for this tenant using the plain siteId (not composite)
            const plainSiteId = site.info.id;
            const commitLevel = commitLevelMap.get(`${plainSiteId}:${tenant.id}`);
            
            const baseRow = {
              timestamp,
              siteId: plainSiteId,
              site: site.info.name,
              siteLocation: site.info.location,
              platform: site.platformType.toUpperCase(),
              tenantId: tenant.id,
              tenant: tenant.name,
              businessId: tenant.orgName || '',
              businessName: tenant.orgFullName || '',
              status: tenant.status,
              vmCount: tenant.vmCount,
              runningVmCount: tenant.runningVmCount,
              cpuAllocatedMHz: tenant.cpu.allocated,
              cpuUsedMHz: tenant.cpu.used,
              ramAllocatedMB: tenant.memory.allocated,
              ramUsedMB: tenant.memory.used,
              storageTotalMB: tenant.storage.limit,
              storageUsedMB: tenant.storage.used,
              allocatedIps: tenant.allocatedIps || 0,
              commitVcpu: commitLevel?.vcpuCount || '',
              commitGhz: commitLevel?.vcpuSpeedGhz || '',
              commitRamGB: commitLevel?.ramGB || '',
              commitHpsGB: commitLevel?.storageHpsGB || '',
              commitSpsGB: commitLevel?.storageSpsGB || '',
              commitVvolGB: commitLevel?.storageVvolGB || '',
              commitOtherGB: commitLevel?.storageOtherGB || '',
              commitIps: commitLevel?.allocatedIps || '',
              commitNotes: commitLevel?.notes || '',
            };
            
            // If tenant has storage tiers, create a row for each tier
            if (tenant.storageTiers && tenant.storageTiers.length > 0) {
              for (const tier of tenant.storageTiers) {
                rows.push({
                  ...baseRow,
                  storageTier: tier.name,
                  tierLimitMB: tier.limit,
                  tierUsedMB: tier.used,
                });
              }
            } else {
              // No tier breakdown, single row
              rows.push({
                ...baseRow,
                storageTier: 'Default',
                tierLimitMB: tenant.storage.limit,
                tierUsedMB: tenant.storage.used,
              });
            }
          }
        } catch (error: any) {
          log(`Error fetching tenants for ${site.id}: ${error.message}`, 'routes');
        }
      }

      if (format === 'json') {
        res.json(rows);
        return;
      }

      // Generate CSV
      const headers = [
        'Timestamp',
        'Site',
        'Location',
        'Platform',
        'Tenant',
        'Status',
        'VM Count',
        'Running VMs',
        'CPU Allocated (MHz)',
        'CPU Used (MHz)',
        'RAM Allocated (MB)',
        'RAM Used (MB)',
        'Storage Total (MB)',
        'Storage Used (MB)',
        'Storage Tier',
        'Tier Limit (MB)',
        'Tier Used (MB)',
        'Allocated IPs',
        'Commit vCPU',
        'Commit GHz',
        'Commit RAM (GB)',
        'Commit HPS (GB)',
        'Commit SPS (GB)',
        'Commit VVol (GB)',
        'Commit Other (GB)',
        'Commit IPs',
        'Commit Notes',
      ];

      const csvRows = [headers.join(',')];
      
      for (const row of rows) {
        csvRows.push([
          row.timestamp,
          `"${row.site}"`,
          `"${row.siteLocation}"`,
          row.platform,
          `"${row.tenant}"`,
          row.status,
          row.vmCount,
          row.runningVmCount,
          row.cpuAllocatedMHz,
          row.cpuUsedMHz,
          row.ramAllocatedMB,
          row.ramUsedMB,
          row.storageTotalMB,
          row.storageUsedMB,
          `"${row.storageTier}"`,
          row.tierLimitMB,
          row.tierUsedMB,
          row.allocatedIps,
          row.commitVcpu,
          row.commitGhz,
          row.commitRamGB,
          row.commitHpsGB,
          row.commitSpsGB,
          row.commitVvolGB,
          row.commitOtherGB,
          row.commitIps,
          `"${row.commitNotes}"`,
        ].join(','));
      }

      const csv = csvRows.join('\n');
      const filename = `tenant-export-${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error: any) {
      log(`Error exporting tenants: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/config/sites
   * Get all configured platform sites from database
   */
  app.get('/api/config/sites', async (req, res) => {
    try {
      const sites = await storage.getAllPlatformSites();
      const safeSites = sites.map(site => ({
        ...site,
        password: site.password ? '********' : null,
        secretKey: site.secretKey ? '********' : null,
      }));
      res.json(safeSites);
    } catch (error: any) {
      log(`Error fetching configured sites: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/config/sites/:id
   * Get a specific platform site configuration
   */
  app.get('/api/config/sites/:id', async (req, res) => {
    try {
      const site = await storage.getPlatformSite(req.params.id);
      if (!site) {
        return res.status(404).json({ error: 'Site not found' });
      }
      const safeSite = {
        ...site,
        password: site.password ? '********' : null,
        secretKey: site.secretKey ? '********' : null,
      };
      res.json(safeSite);
    } catch (error: any) {
      log(`Error fetching site config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/config/sites
   * Create a new platform site configuration
   */
  app.post('/api/config/sites', async (req, res) => {
    try {
      const parsed = insertPlatformSiteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors });
      }

      const existing = await storage.getPlatformSiteBySiteId(parsed.data.siteId);
      if (existing) {
        return res.status(409).json({ error: 'Site ID already exists' });
      }

      const site = await storage.createPlatformSite(parsed.data);
      
      platformRegistry.addSiteFromConfig(site);
      
      log(`Created new platform site: ${site.siteId} (${site.platformType})`, 'routes');
      res.status(201).json({ ...site, password: '********', secretKey: site.secretKey ? '********' : null });
    } catch (error: any) {
      log(`Error creating site config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/config/sites/:id
   * Update an existing platform site configuration
   */
  app.put('/api/config/sites/:id', async (req, res) => {
    try {
      const parsed = updatePlatformSiteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid request body', details: parsed.error.errors });
      }

      const existingSite = await storage.getPlatformSite(req.params.id);
      if (!existingSite) {
        return res.status(404).json({ error: 'Site not found' });
      }

      if (parsed.data.password === '********') {
        delete parsed.data.password;
      }
      if (parsed.data.secretKey === '********') {
        delete parsed.data.secretKey;
      }

      const site = await storage.updatePlatformSite(req.params.id, parsed.data);
      if (!site) {
        return res.status(404).json({ error: 'Site not found' });
      }

      platformRegistry.removeSite(existingSite.siteId, existingSite.platformType as PlatformType);
      platformRegistry.addSiteFromConfig(site);
      
      log(`Updated platform site: ${site.siteId} (${site.platformType})`, 'routes');
      res.json({ ...site, password: '********', secretKey: site.secretKey ? '********' : null });
    } catch (error: any) {
      log(`Error updating site config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/config/sites/:id
   * Delete a platform site configuration
   */
  app.delete('/api/config/sites/:id', async (req, res) => {
    try {
      const existingSite = await storage.getPlatformSite(req.params.id);
      if (!existingSite) {
        return res.status(404).json({ error: 'Site not found' });
      }

      await storage.deletePlatformSite(req.params.id);
      platformRegistry.removeSite(existingSite.siteId, existingSite.platformType as PlatformType);
      
      log(`Deleted platform site: ${existingSite.siteId}`, 'routes');
      res.status(204).send();
    } catch (error: any) {
      log(`Error deleting site config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/config/sites/:id/test
   * Test connection to a configured site
   */
  app.post('/api/config/sites/:id/test', async (req, res) => {
    try {
      const site = await storage.getPlatformSite(req.params.id);
      if (!site) {
        return res.status(404).json({ error: 'Site not found' });
      }

      const client = platformRegistry.getClientBySiteId(site.siteId);
      if (!client) {
        return res.json({ success: false, message: 'Client not initialized' });
      }

      const success = await client.testConnection();
      res.json({ success, message: success ? 'Connection successful' : 'Connection failed' });
    } catch (error: any) {
      log(`Error testing site connection: ${error.message}`, 'routes');
      res.json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/sites/:siteId/provisioning-resources
   * Get available resources for provisioning (Provider VDCs, storage profiles, external networks)
   */
  app.get('/api/sites/:siteId/provisioning-resources', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = platformRegistry.getClient(siteId);
      
      if (!client) {
        return res.status(404).json({ error: `Site not found: ${siteId}` });
      }

      if (client.getPlatformType() !== 'vcd') {
        return res.status(400).json({ error: 'Provisioning is only supported for VCD sites' });
      }

      const vcdClient = (client as any).vcdClient;
      if (!vcdClient) {
        return res.status(500).json({ error: 'VCD client not available' });
      }

      const resources = await vcdClient.getProvisioningResources();
      res.json(resources);
    } catch (error: any) {
      log(`Error fetching provisioning resources: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/sites/:siteId/provision
   * Provision new VCD resources (Org, Org VDC, Edge Gateway, NAT rules)
   */
  app.post('/api/sites/:siteId/provision', async (req, res) => {
    try {
      const { siteId } = req.params;
      const client = platformRegistry.getClient(siteId);
      
      if (!client) {
        return res.status(404).json({ error: `Site not found: ${siteId}` });
      }

      if (client.getPlatformType() !== 'vcd') {
        return res.status(400).json({ error: 'Provisioning is only supported for VCD sites' });
      }

      const vcdClient = (client as any).vcdClient;
      if (!vcdClient) {
        return res.status(500).json({ error: 'VCD client not available' });
      }

      const {
        orgName,
        orgFullName,
        orgDescription,
        vdcName,
        allocationModel,
        cpuAllocatedMHz,
        cpuLimitMHz,
        memoryAllocatedMB,
        memoryLimitMB,
        storageProfileName,
        storageLimitMB,
        networkQuota,
        edgeGatewayName,
        externalNetworkId,
        primaryIpAddress,
        internalSubnet,
      } = req.body;

      if (!orgName || !vdcName) {
        return res.status(400).json({ error: 'orgName and vdcName are required' });
      }

      log(`Starting provisioning for ${orgName} on ${siteId}`, 'routes');

      const providerVdcs = await vcdClient.getProviderVdcs();
      if (providerVdcs.length === 0) {
        return res.status(400).json({ error: 'No Provider VDCs available' });
      }
      const providerVdc = providerVdcs[0];
      
      let storageProfileId = storageProfileName;
      if (!storageProfileId && providerVdc.storageProfiles?.length > 0) {
        storageProfileId = providerVdc.storageProfiles[0].id || providerVdc.storageProfiles[0].href?.split('/').pop();
      }

      const org = await vcdClient.createOrganization({
        name: orgName,
        displayName: orgFullName || orgName,
        description: orgDescription,
      });
      log(`Organization created: ${org.id}`, 'routes');

      const vdc = await vcdClient.createOrgVdc({
        orgId: org.id,
        name: vdcName,
        description: `VDC for ${orgFullName || orgName}`,
        allocationModel: allocationModel || 'AllocationVApp',
        providerVdcId: providerVdc.id,
        networkPoolId: providerVdc.networkPools?.[0]?.id,
        cpuAllocatedMHz: cpuAllocatedMHz || 10000,
        cpuLimitMHz: cpuLimitMHz || 10000,
        memoryAllocatedMB: memoryAllocatedMB || 16384,
        memoryLimitMB: memoryLimitMB || 16384,
        storageProfileId,
        storageLimitMB: storageLimitMB || 102400,
        networkQuota: networkQuota || 10,
      });
      log(`Org VDC created: ${vdc.id}`, 'routes');

      let edgeGateway = null;
      let snatRule = null;

      if (externalNetworkId && edgeGatewayName) {
        edgeGateway = await vcdClient.createEdgeGateway({
          name: edgeGatewayName,
          description: `Edge Gateway for ${orgFullName || orgName}`,
          orgVdcId: vdc.id,
          orgId: org.id,
          externalNetworkId,
          primaryIpAddress,
        });
        log(`Edge Gateway created: ${edgeGateway.id}`, 'routes');

        if (edgeGateway.primaryIp && internalSubnet) {
          snatRule = await vcdClient.createSnatRule({
            edgeGatewayId: edgeGateway.id,
            name: `Outbound-SNAT-${orgName}`,
            externalAddress: edgeGateway.primaryIp,
            internalAddresses: internalSubnet,
          });
          log(`SNAT rule created: ${snatRule.id}`, 'routes');
        }
      }

      res.json({
        success: true,
        orgId: org.id,
        orgName: org.name,
        vdcId: vdc.id,
        vdcName: vdc.name,
        edgeGatewayId: edgeGateway?.id,
        edgeGatewayName: edgeGateway?.name,
        primaryIp: edgeGateway?.primaryIp,
        snatRuleId: snatRule?.id,
      });
    } catch (error: any) {
      log(`Provisioning error: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
