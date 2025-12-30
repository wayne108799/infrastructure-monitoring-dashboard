import type { Express } from "express";
import { createServer, type Server } from "http";
import { log } from "./index";
import { platformRegistry, type PlatformType, type SiteSummary, VeeamOneClient } from "./lib/platforms";
import { storage } from "./storage";
import { insertPlatformSiteSchema, updatePlatformSiteSchema, insertTenantCommitLevelSchema } from "@shared/schema";
import { pollAllSites, getLatestSiteSummary, getLatestTenantAllocations, getLastPollTime, getHighWaterMarkForMonth, getAvailableMonths } from "./lib/pollingService";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Load sites from database only (GUI-based configuration)
  try {
    const dbSites = await storage.getAllPlatformSites();
    
    // If no sites in database, migrate from environment variables (one-time migration)
    if (dbSites.length === 0) {
      log('No sites in database. Attempting one-time migration from environment variables...', 'routes');
      await migrateEnvSitesToDatabase();
      const migratedSites = await storage.getAllPlatformSites();
      if (migratedSites.length > 0) {
        await platformRegistry.initializeFromDatabase(migratedSites);
        log(`Migrated ${migratedSites.length} sites from environment variables to database`, 'routes');
      } else {
        log('No sites configured. Add platform connections in Settings.', 'routes');
      }
    } else {
      await platformRegistry.initializeFromDatabase(dbSites);
      log(`Loaded ${dbSites.length} sites from database`, 'routes');
    }
  } catch (error) {
    log(`ERROR: Could not load sites from database: ${error}. Configure sites through Settings once database is available.`, 'routes');
    // Do not fall back to env vars - database is the only source of truth
  }
  
  // Helper function to migrate environment variables to database
  async function migrateEnvSitesToDatabase(): Promise<void> {
    const platforms = [
      { type: 'vcd' as PlatformType, prefix: 'VCD' },
      { type: 'cloudstack' as PlatformType, prefix: 'CLOUDSTACK' },
      { type: 'proxmox' as PlatformType, prefix: 'PROXMOX' },
    ];
    
    for (const { type, prefix } of platforms) {
      const sitesEnv = process.env[`${prefix}_SITES`] || '';
      const siteIds = sitesEnv.split(',').map(s => s.trim()).filter(Boolean);
      
      for (const siteId of siteIds) {
        const upperSiteId = siteId.toUpperCase();
        const url = process.env[`${prefix}_${upperSiteId}_URL`];
        const username = process.env[`${prefix}_${upperSiteId}_USERNAME`];
        const password = process.env[`${prefix}_${upperSiteId}_PASSWORD`];
        const name = process.env[`${prefix}_${upperSiteId}_NAME`] || siteId;
        const location = process.env[`${prefix}_${upperSiteId}_LOCATION`] || 'Unknown';
        const org = process.env[`${prefix}_${upperSiteId}_ORG`];
        const apiKey = process.env[`${prefix}_${upperSiteId}_API_KEY`];
        const secretKey = process.env[`${prefix}_${upperSiteId}_SECRET_KEY`];
        const realm = process.env[`${prefix}_${upperSiteId}_REALM`];
        
        if (!url) continue;
        
        try {
          await storage.createPlatformSite({
            siteId,
            platformType: type,
            name,
            location,
            url,
            username: username || null,
            password: password || null,
            org: org || null,
            apiKey: apiKey || null,
            secretKey: secretKey || null,
            realm: realm || null,
            isEnabled: true,
          });
          log(`Migrated ${type} site ${siteId} to database`, 'routes');
        } catch (error) {
          log(`Failed to migrate ${type} site ${siteId}: ${error}`, 'routes');
        }
      }
    }
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

      // Get management links from database
      const dbSites = await storage.getAllPlatformSites();
      const linksMap = new Map<string, any>();
      for (const dbSite of dbSites) {
        linksMap.set(dbSite.siteId, {
          vcenterUrl: dbSite.vcenterUrl,
          nsxUrl: dbSite.nsxUrl,
          ariaUrl: dbSite.ariaUrl,
          veeamUrl: dbSite.veeamUrl,
        });
      }

      const siteList = sites.map(({ id, platformType, info }) => {
        const links = linksMap.get(info.id) || {};
        return {
          id: info.id,
          compositeId: id,
          name: info.name,
          location: info.location,
          url: info.url,
          platformType,
          status: info.status,
          managementLinks: {
            vcd: info.url,
            vcenter: links.vcenterUrl || null,
            nsx: links.nsxUrl || null,
            aria: links.ariaUrl || null,
            veeam: links.veeamUrl || null,
          },
        };
      });

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
   * GET /api/polling/status
   * Get polling status and last poll time
   */
  app.get('/api/polling/status', async (req, res) => {
    try {
      const lastPollTime = await getLastPollTime();
      res.json({
        lastPollTime,
        pollingIntervalHours: 4,
        nextPollTime: lastPollTime 
          ? new Date(lastPollTime.getTime() + 4 * 60 * 60 * 1000)
          : null,
      });
    } catch (error: any) {
      log(`Error fetching polling status: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/polling/trigger
   * Manually trigger a poll cycle
   */
  app.post('/api/polling/trigger', async (req, res) => {
    try {
      log('Manual poll triggered', 'routes');
      pollAllSites().catch(err => log(`Poll error: ${err.message}`, 'routes'));
      res.json({ success: true, message: 'Poll cycle started' });
    } catch (error: any) {
      log(`Error triggering poll: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/report/high-water-mark
   * Get highest usage values for each tenant in a given month (for billing)
   */
  app.get('/api/report/high-water-mark', async (req, res) => {
    try {
      const { year, month } = req.query;
      
      // Default to current month if not specified
      const now = new Date();
      let targetYear = now.getFullYear();
      let targetMonth = now.getMonth() + 1;
      
      if (year) {
        const parsedYear = parseInt(year as string, 10);
        if (isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
          return res.status(400).json({ error: 'Invalid year parameter. Must be between 2000 and 2100.' });
        }
        targetYear = parsedYear;
      }
      
      if (month) {
        const parsedMonth = parseInt(month as string, 10);
        if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
          return res.status(400).json({ error: 'Invalid month parameter. Must be between 1 and 12.' });
        }
        targetMonth = parsedMonth;
      }
      
      const highWaterMarks = await getHighWaterMarkForMonth(targetYear, targetMonth);
      
      // Enrich with site info and commit levels
      const allCommitLevels = await storage.getAllCommitLevels();
      const commitLevelMap = new Map<string, typeof allCommitLevels[0]>();
      for (const level of allCommitLevels) {
        commitLevelMap.set(`${level.siteId}:${level.tenantId}`, level);
      }
      
      // Get platform site info
      const allSites = await storage.getAllPlatformSites();
      const siteInfoMap = new Map<string, typeof allSites[0]>();
      for (const site of allSites) {
        siteInfoMap.set(site.siteId, site);
      }
      
      const enrichedData = highWaterMarks.map(hwm => {
        const commitLevel = commitLevelMap.get(`${hwm.siteId}:${hwm.tenantId}`);
        const siteInfo = siteInfoMap.get(hwm.siteId);
        
        // Convert storage tiers to expected format
        let storageHpsGB = 0;
        let storageSpsGB = 0;
        let storageVvolGB = 0;
        let storageOtherGB = 0;
        
        for (const [tierName, tierData] of Object.entries(hwm.storageTiers)) {
          const tierGB = Math.round(tierData.maxUsedMB / 1024);
          const lowerName = tierName.toLowerCase();
          if (lowerName.includes('hps') || lowerName.includes('high')) {
            storageHpsGB += tierGB;
          } else if (lowerName.includes('sps') || lowerName.includes('standard')) {
            storageSpsGB += tierGB;
          } else if (lowerName.includes('vvol')) {
            storageVvolGB += tierGB;
          } else {
            storageOtherGB += tierGB;
          }
        }
        
        return {
          siteId: hwm.siteId,
          site: siteInfo?.name || hwm.siteId,
          siteLocation: siteInfo?.location || '',
          platform: (siteInfo?.platformType || 'vcd').toUpperCase(),
          tenantId: hwm.tenantId,
          tenant: hwm.tenantName,
          businessId: commitLevel?.businessId || hwm.orgName || '',
          businessName: commitLevel?.businessName || hwm.orgFullName || '',
          // High water mark values (max for the month)
          vcpu: Math.round(hwm.maxCpuUsedMHz / 2800),
          cpuUsedMHz: hwm.maxCpuUsedMHz,
          ramGB: Math.round(hwm.maxRamUsedMB / 1024),
          ramUsedMB: hwm.maxRamUsedMB,
          storageHpsGB,
          storageSpsGB,
          storageVvolGB,
          storageOtherGB,
          allocatedIps: hwm.maxAllocatedIps,
          snapshotCount: hwm.snapshotCount,
          // Commit levels
          commitVcpu: commitLevel?.vcpuCount || '',
          commitRamGB: commitLevel?.ramGB || '',
          commitHpsGB: commitLevel?.storageHpsGB || '',
          commitSpsGB: commitLevel?.storageSpsGB || '',
          commitVvolGB: commitLevel?.storageVvolGB || '',
          commitOtherGB: commitLevel?.storageOtherGB || '',
          commitIps: commitLevel?.allocatedIps || '',
          notes: commitLevel?.notes || '',
        };
      });
      
      res.json({
        year: targetYear,
        month: targetMonth,
        data: enrichedData,
      });
    } catch (error: any) {
      log(`Error fetching high water mark data: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/report/available-months
   * Get list of months that have polling data
   */
  app.get('/api/report/available-months', async (req, res) => {
    try {
      const months = await getAvailableMonths();
      res.json(months);
    } catch (error: any) {
      log(`Error fetching available months: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/polling/site/:siteId/summary
   * Get cached site summary from last poll
   */
  app.get('/api/polling/site/:siteId/summary', async (req, res) => {
    try {
      const { siteId } = req.params;
      const summary = await getLatestSiteSummary(siteId);
      
      if (!summary) {
        return res.status(404).json({ error: 'No cached data available for this site' });
      }
      
      res.json(summary);
    } catch (error: any) {
      log(`Error fetching cached summary: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/polling/site/:siteId/tenants
   * Get cached tenant allocations from last poll
   */
  app.get('/api/polling/site/:siteId/tenants', async (req, res) => {
    try {
      const { siteId } = req.params;
      const tenants = await getLatestTenantAllocations(siteId);
      res.json(tenants);
    } catch (error: any) {
      log(`Error fetching cached tenants: ${error.message}`, 'routes');
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
      
      // Get storage capacity overrides from database
      const storageOverrides = await storage.getStorageConfigBySite(siteId);
      const overrideMap = new Map(storageOverrides.map(o => [o.tierName.toLowerCase(), o.usableCapacityGB]));
      
      // Apply overrides to storage tiers
      let totalConfiguredCapacity = 0;
      const storageTiers = summary.storageTiers || [];
      const enhancedTiers = storageTiers.map(tier => {
        const overrideGB = overrideMap.get(tier.name.toLowerCase());
        const configuredCapacityMB = overrideGB ? overrideGB * 1024 : null;
        if (configuredCapacityMB) {
          totalConfiguredCapacity += configuredCapacityMB;
        }
        return {
          ...tier,
          configuredCapacity: configuredCapacityMB,
          configuredCapacityGB: overrideGB || null,
          hasConfiguredCapacity: !!configuredCapacityMB,
        };
      });
      
      // Add any manually configured tiers that weren't discovered from the platform
      const discoveredTierNames = new Set(storageTiers.map(t => t.name.toLowerCase()));
      for (const override of storageOverrides) {
        if (!discoveredTierNames.has(override.tierName.toLowerCase())) {
          const capacityMB = override.usableCapacityGB * 1024;
          totalConfiguredCapacity += capacityMB;
          enhancedTiers.push({
            name: override.tierName,
            capacity: capacityMB,
            limit: capacityMB,
            used: 0,
            available: capacityMB,
            units: 'MB',
            configuredCapacity: capacityMB,
            configuredCapacityGB: override.usableCapacityGB,
            hasConfiguredCapacity: true,
          });
        }
      }
      
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
          configuredCapacity: totalConfiguredCapacity || null,
        },
        storageTiers: enhancedTiers,
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
   * GET /api/config/sites/:siteId/storage
   * Get storage capacity configuration for a site
   */
  app.get('/api/config/sites/:siteId/storage', async (req, res) => {
    try {
      const configs = await storage.getStorageConfigBySite(req.params.siteId);
      res.json(configs);
    } catch (error: any) {
      log(`Error fetching storage config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/config/sites/:siteId/storage/discovered
   * Get discovered storage tiers from the platform merged with configured overrides
   */
  app.get('/api/config/sites/:siteId/storage/discovered', async (req, res) => {
    try {
      const { siteId } = req.params;
      
      // Get discovered tiers from the platform
      const client = platformRegistry.getClientBySiteId(siteId);
      let discoveredTiers: Array<{ name: string; capacityMB: number; usedMB: number }> = [];
      
      if (client) {
        try {
          const summary = await client.getSiteSummary();
          if (summary.storageTiers) {
            discoveredTiers = summary.storageTiers.map(tier => ({
              name: tier.name,
              capacityMB: tier.capacity,
              usedMB: tier.used,
            }));
          }
        } catch (e: any) {
          log(`Could not fetch storage tiers from platform: ${e.message}`, 'routes');
        }
      }
      
      // Get configured overrides from database
      const configs = await storage.getStorageConfigBySite(siteId);
      const configMap = new Map(configs.map(c => [c.tierName.toLowerCase(), c]));
      
      // Merge discovered tiers with configured overrides
      const mergedTiers = discoveredTiers.map(tier => {
        const config = configMap.get(tier.name.toLowerCase());
        return {
          name: tier.name,
          discoveredCapacityMB: tier.capacityMB,
          discoveredCapacityGB: Math.round(tier.capacityMB / 1024),
          usedMB: tier.usedMB,
          usedGB: Math.round(tier.usedMB / 1024),
          configuredCapacityGB: config?.usableCapacityGB || null,
          hasOverride: !!config,
        };
      });
      
      // Add any configured tiers that weren't discovered
      for (const config of configs) {
        const exists = mergedTiers.some(t => t.name.toLowerCase() === config.tierName.toLowerCase());
        if (!exists) {
          mergedTiers.push({
            name: config.tierName,
            discoveredCapacityMB: 0,
            discoveredCapacityGB: 0,
            usedMB: 0,
            usedGB: 0,
            configuredCapacityGB: config.usableCapacityGB,
            hasOverride: true,
          });
        }
      }
      
      res.json({
        siteId,
        tiers: mergedTiers,
        platformConnected: !!client,
      });
    } catch (error: any) {
      log(`Error fetching discovered storage: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/config/sites/:siteId/storage
   * Set storage capacity for a tier
   */
  app.post('/api/config/sites/:siteId/storage', async (req, res) => {
    try {
      const { tierName, usableCapacityGB } = req.body;
      if (!tierName || usableCapacityGB === undefined) {
        return res.status(400).json({ error: 'tierName and usableCapacityGB are required' });
      }
      
      const config = await storage.upsertStorageConfig({
        siteId: req.params.siteId,
        tierName,
        usableCapacityGB: parseInt(usableCapacityGB, 10),
      });
      res.json(config);
    } catch (error: any) {
      log(`Error saving storage config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/config/sites/:siteId/storage/:tierName
   * Delete storage capacity configuration for a tier
   */
  app.delete('/api/config/sites/:siteId/storage/:tierName', async (req, res) => {
    try {
      await storage.deleteStorageConfig(req.params.siteId, req.params.tierName);
      res.json({ success: true });
    } catch (error: any) {
      log(`Error deleting storage config: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
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
