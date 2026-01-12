import type { Express } from "express";
import { createServer, type Server } from "http";
import { log } from "./index";
import { platformRegistry, type PlatformType, type SiteSummary } from "./lib/platforms";
import { VspcClient, createVspcClient } from "./lib/platforms/vspcClient";
import { storage } from "./storage";
import { insertPlatformSiteSchema, updatePlatformSiteSchema, insertTenantCommitLevelSchema } from "@shared/schema";
import { pollAllSites, getLatestSiteSummary, getLatestTenantAllocations, getLastPollTime, getHighWaterMarkForMonth, getAvailableMonths, getOverageData } from "./lib/pollingService";
import { getAllMonitorStatuses, getMonitorStatusForSite, triggerMonitorCheck, startMonitorService } from "./lib/monitorService";

const vspcClientCache = new Map<string, VspcClient>();

async function getVspcClientForSite(siteId: string): Promise<VspcClient | null> {
  if (vspcClientCache.has(siteId)) {
    return vspcClientCache.get(siteId)!;
  }
  
  // Use getPlatformSiteBySiteId to lookup by siteId (e.g. "ATL3") not UUID
  const site = await storage.getPlatformSiteBySiteId(siteId);
  if (!site || site.platformType !== 'vcd') {
    log(`VSPC: Site ${siteId} not found or not VCD`, 'routes');
    return null;
  }
  
  if (!site.vspcUrl || !site.vspcUsername || !site.vspcPassword) {
    log(`VSPC: Site ${siteId} missing VSPC configuration (url: ${!!site.vspcUrl}, user: ${!!site.vspcUsername}, pass: ${!!site.vspcPassword})`, 'routes');
    return null;
  }
  
  log(`VSPC: Creating client for ${siteId} at ${site.vspcUrl}`, 'routes');
  const client = createVspcClient({
    url: site.vspcUrl,
    username: site.vspcUsername,
    password: site.vspcPassword,
  });
  
  if (client) {
    vspcClientCache.set(siteId, client);
  }
  
  return client;
}

function clearVspcClientCache(siteId?: string) {
  if (siteId) {
    vspcClientCache.delete(siteId);
  } else {
    vspcClientCache.clear();
  }
}

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
              type,
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
        // Strip platform prefix from siteId to match commit level key format
        // hwm.siteId is "vcd:ATL3", commit levels are stored with "ATL3"
        const plainSiteId = hwm.siteId.includes(':') ? hwm.siteId.split(':')[1] : hwm.siteId;
        const commitLevel = commitLevelMap.get(`${plainSiteId}:${hwm.tenantId}`);
        const siteInfo = siteInfoMap.get(plainSiteId);
        
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
          // Reporting disabled status
          isReportingDisabled: commitLevel?.isReportingDisabled || false,
          disabledReason: commitLevel?.disabledReason || '',
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
   * GET /api/report/overages
   * Get overage data over time for graphing
   */
  app.get('/api/report/overages', async (req, res) => {
    try {
      const { startDate, endDate, siteId, tenantId } = req.query;
      
      const options: {
        startDate?: Date;
        endDate?: Date;
        siteId?: string;
        tenantId?: string;
      } = {};
      
      if (startDate) {
        options.startDate = new Date(startDate as string);
      }
      if (endDate) {
        options.endDate = new Date(endDate as string);
      }
      if (siteId) {
        options.siteId = siteId as string;
      }
      if (tenantId) {
        options.tenantId = tenantId as string;
      }
      
      const usageData = await getOverageData(options);
      
      // Get commit levels to compare - use siteId:tenantId as key
      const commitLevels = await storage.getAllCommitLevels();
      const commitMap = new Map<string, typeof commitLevels[0]>();
      for (const cl of commitLevels) {
        commitMap.set(`${cl.siteId}:${cl.tenantId}`, cl);
      }
      
      // Calculate overages by comparing usage to commit levels
      const overageData = usageData.map(usage => {
        // Strip platform prefix from siteId to match commit level key format
        // usage.siteId is "vcd:ATL3", commit levels are stored with "ATL3"
        const plainSiteId = usage.siteId.includes(':') ? usage.siteId.split(':')[1] : usage.siteId;
        const commit = commitMap.get(`${plainSiteId}:${usage.tenantId}`);
        
        // Convert vCPU commit to MHz (vcpu * speed * 1000)
        const commitCpuMHz = commit && commit.vcpuCount && commit.vcpuSpeedGhz 
          ? parseFloat(commit.vcpuCount) * parseFloat(commit.vcpuSpeedGhz) * 1000 
          : 0;
        const commitRamMB = commit && commit.ramGB ? parseFloat(commit.ramGB) * 1024 : 0;
        
        // Storage commits in GB, convert to MB
        const commitStorageHpsMB = commit && commit.storageHpsGB ? parseFloat(commit.storageHpsGB) * 1024 : 0;
        const commitStorageSpsMB = commit && commit.storageSpsGB ? parseFloat(commit.storageSpsGB) * 1024 : 0;
        const commitStorageVvolMB = commit && commit.storageVvolGB ? parseFloat(commit.storageVvolGB) * 1024 : 0;
        
        return {
          ...usage,
          commitCpuMHz,
          commitRamMB,
          commitStorageHpsMB,
          commitStorageSpsMB,
          commitStorageVvolMB,
          cpuOverageMHz: Math.max(0, usage.cpuUsedMHz - commitCpuMHz),
          ramOverageMB: Math.max(0, usage.ramUsedMB - commitRamMB),
          hasCommit: !!commit,
        };
      });
      
      res.json(overageData);
    } catch (error: any) {
      log(`Error fetching overage data: ${error.message}`, 'routes');
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
        ipAllocation: tenant.ipAllocation || {
          totalIpCount: tenant.allocatedIps || 0,
          usedIpCount: tenant.allocatedIps || 0,
          freeIpCount: 0,
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
   * POST /api/vspc/:siteId/test-connection
   * Test VSPC connection for a VCD site
   */
  app.post('/api/vspc/:siteId/test-connection', async (req, res) => {
    try {
      const { siteId } = req.params;
      const { url, username, password } = req.body;
      
      if (!url || !username || !password) {
        return res.status(400).json({ error: 'Missing required fields: url, username, password' });
      }
      
      const testClient = createVspcClient({ url, username, password });
      if (!testClient) {
        return res.status(400).json({ success: false, error: 'Invalid VSPC configuration' });
      }
      
      const result = await testClient.testConnection();
      
      if (result.success) {
        res.json({ success: true, message: 'Successfully connected to VSPC' });
      } else {
        res.json({ success: false, error: result.error || 'Could not connect to VSPC' });
      }
    } catch (error: any) {
      log(`Error testing VSPC connection: ${error.message}`, 'routes');
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/vspc/:siteId/summary
   * Get VSPC backup summary for a VCD site
   */
  app.get('/api/vspc/:siteId/summary', async (req, res) => {
    try {
      const { siteId } = req.params;
      const vspcClient = await getVspcClientForSite(siteId);
      
      if (!vspcClient) {
        return res.json({ 
          configured: false, 
          message: 'VSPC not configured for this site' 
        });
      }
      
      const summary = await vspcClient.getSummary();
      
      res.json({
        configured: true,
        siteId,
        ...summary,
      });
    } catch (error: any) {
      log(`Error fetching VSPC summary for ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/vspc/:siteId/backup-by-org
   * Get backup metrics by organization ID from VSPC for a VCD site
   */
  app.get('/api/vspc/:siteId/backup-by-org', async (req, res) => {
    try {
      const { siteId } = req.params;
      const vspcClient = await getVspcClientForSite(siteId);
      
      if (!vspcClient) {
        return res.json({ 
          configured: false, 
          organizations: {} 
        });
      }
      
      const metricsMap = await vspcClient.getBackupMetricsByOrgId();
      
      const organizations: Record<string, {
        orgId: string;
        orgName: string;
        protectedVmCount: number;
        totalVmCount: number;
        backupSizeGB: number;
        protectionPercentage: number;
      }> = {};
      
      for (const [orgId, metrics] of Array.from(metricsMap.entries())) {
        organizations[orgId] = metrics;
      }
      
      res.json({
        configured: true,
        siteId,
        organizations,
      });
    } catch (error: any) {
      log(`Error fetching VSPC backup by org for ${req.params.siteId}: ${error.message}`, 'routes');
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
   * POST /api/commit-levels/:siteId/:tenantId/toggle-reporting
   * Toggle reporting enabled/disabled for a tenant
   */
  app.post('/api/commit-levels/:siteId/:tenantId/toggle-reporting', async (req, res) => {
    try {
      const { siteId, tenantId } = req.params;
      const { isDisabled, reason, tenantName } = req.body;
      
      // Get existing commit level or create minimal entry
      let existing = await storage.getCommitLevel(siteId, tenantId);
      
      if (existing) {
        // Update existing entry
        const updated = await storage.upsertCommitLevel({
          ...existing,
          isReportingDisabled: isDisabled,
          disabledReason: isDisabled ? reason : null,
        });
        res.json(updated);
      } else {
        // Create new minimal entry just for tracking disabled status
        const created = await storage.upsertCommitLevel({
          siteId,
          tenantId,
          tenantName: tenantName || tenantId,
          isReportingDisabled: isDisabled,
          disabledReason: isDisabled ? reason : null,
        });
        res.json(created);
      }
    } catch (error: any) {
      log(`Error toggling tenant reporting: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/export/tenants
   * Export all tenant allocations as CSV
   * Supports filters: platform, siteId, showDisabled
   */
  app.get('/api/export/tenants', async (req, res) => {
    try {
      const { format = 'csv', platform, siteId, showDisabled } = req.query;
      let sites = platformRegistry.getAllSites();
      
      // Apply platform filter
      if (platform && typeof platform === 'string') {
        sites = sites.filter(s => s.platformType.toLowerCase() === platform.toLowerCase());
      }
      
      // Apply siteId filter
      if (siteId && typeof siteId === 'string') {
        sites = sites.filter(s => s.id === siteId || s.info.id === siteId);
      }
      
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
        vcpuAllocated: number;
        vcpuUsed: number;
        ramAllocatedGB: number;
        ramUsedGB: number;
        storageTotalGB: number;
        storageUsedGB: number;
        storageTier: string;
        tierLimitGB: number;
        tierUsedGB: number;
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
        vcpuOverage: number;
        ramOverageGB: number;
        storageHpsOverageGB: number;
        storageSpsOverageGB: number;
        storageVvolOverageGB: number;
        storageOtherOverageGB: number;
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
            
            // Skip disabled tenants unless showDisabled is true
            if (commitLevel?.isReportingDisabled && showDisabled !== 'true') {
              continue;
            }
            
            // Convert MHz to vCPU (using 2800 MHz per vCPU)
            const vcpuAllocated = Math.round((tenant.cpu.allocated / 2800) * 100) / 100;
            const vcpuUsed = Math.round((tenant.cpu.used / 2800) * 100) / 100;
            
            // Convert MB to GB
            const ramAllocatedGB = Math.round((tenant.memory.allocated / 1024) * 100) / 100;
            const ramUsedGB = Math.round((tenant.memory.used / 1024) * 100) / 100;
            const storageTotalGB = Math.round((tenant.storage.limit / 1024) * 100) / 100;
            const storageUsedGB = Math.round((tenant.storage.used / 1024) * 100) / 100;
            
            // Calculate overages (used - commit, if positive)
            const commitVcpuNum = commitLevel?.vcpuCount ? parseFloat(commitLevel.vcpuCount) : 0;
            const commitRamGBNum = commitLevel?.ramGB ? parseFloat(commitLevel.ramGB) : 0;
            const commitHpsGBNum = commitLevel?.storageHpsGB ? parseFloat(commitLevel.storageHpsGB) : 0;
            const commitSpsGBNum = commitLevel?.storageSpsGB ? parseFloat(commitLevel.storageSpsGB) : 0;
            const commitVvolGBNum = commitLevel?.storageVvolGB ? parseFloat(commitLevel.storageVvolGB) : 0;
            const commitOtherGBNum = commitLevel?.storageOtherGB ? parseFloat(commitLevel.storageOtherGB) : 0;
            
            const vcpuOverage = commitVcpuNum > 0 ? Math.max(0, Math.round((vcpuUsed - commitVcpuNum) * 100) / 100) : 0;
            const ramOverageGB = commitRamGBNum > 0 ? Math.max(0, Math.round((ramUsedGB - commitRamGBNum) * 100) / 100) : 0;
            
            // Calculate storage used per tier for overage calculation
            let hpsUsedGB = 0, spsUsedGB = 0, vvolUsedGB = 0, otherUsedGB = 0;
            if (tenant.storageTiers && tenant.storageTiers.length > 0) {
              for (const tier of tenant.storageTiers) {
                const tierUsedGB = tier.used / 1024;
                const lowerName = tier.name.toLowerCase();
                if (lowerName.includes('hps') || lowerName.includes('high')) {
                  hpsUsedGB += tierUsedGB;
                } else if (lowerName.includes('sps') || lowerName.includes('standard')) {
                  spsUsedGB += tierUsedGB;
                } else if (lowerName.includes('vvol')) {
                  vvolUsedGB += tierUsedGB;
                } else {
                  otherUsedGB += tierUsedGB;
                }
              }
            }
            
            const storageHpsOverageGB = commitHpsGBNum > 0 ? Math.max(0, Math.round((hpsUsedGB - commitHpsGBNum) * 100) / 100) : 0;
            const storageSpsOverageGB = commitSpsGBNum > 0 ? Math.max(0, Math.round((spsUsedGB - commitSpsGBNum) * 100) / 100) : 0;
            const storageVvolOverageGB = commitVvolGBNum > 0 ? Math.max(0, Math.round((vvolUsedGB - commitVvolGBNum) * 100) / 100) : 0;
            const storageOtherOverageGB = commitOtherGBNum > 0 ? Math.max(0, Math.round((otherUsedGB - commitOtherGBNum) * 100) / 100) : 0;
            
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
              vcpuAllocated,
              vcpuUsed,
              ramAllocatedGB,
              ramUsedGB,
              storageTotalGB,
              storageUsedGB,
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
              vcpuOverage,
              ramOverageGB,
              storageHpsOverageGB,
              storageSpsOverageGB,
              storageVvolOverageGB,
              storageOtherOverageGB,
            };
            
            // If tenant has storage tiers, create a row for each tier
            if (tenant.storageTiers && tenant.storageTiers.length > 0) {
              for (const tier of tenant.storageTiers) {
                rows.push({
                  ...baseRow,
                  storageTier: tier.name,
                  tierLimitGB: Math.round((tier.limit / 1024) * 100) / 100,
                  tierUsedGB: Math.round((tier.used / 1024) * 100) / 100,
                });
              }
            } else {
              // No tier breakdown, single row
              rows.push({
                ...baseRow,
                storageTier: 'Default',
                tierLimitGB: storageTotalGB,
                tierUsedGB: storageUsedGB,
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
        'vCPU Allocated',
        'vCPU Used',
        'RAM Allocated (GB)',
        'RAM Used (GB)',
        'Storage Total (GB)',
        'Storage Used (GB)',
        'Storage Tier',
        'Tier Limit (GB)',
        'Tier Used (GB)',
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
        'vCPU Overage',
        'RAM Overage (GB)',
        'HPS Overage (GB)',
        'SPS Overage (GB)',
        'VVol Overage (GB)',
        'Other Storage Overage (GB)',
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
          row.vcpuAllocated,
          row.vcpuUsed,
          row.ramAllocatedGB,
          row.ramUsedGB,
          row.storageTotalGB,
          row.storageUsedGB,
          `"${row.storageTier}"`,
          row.tierLimitGB,
          row.tierUsedGB,
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
          row.vcpuOverage,
          row.ramOverageGB,
          row.storageHpsOverageGB,
          row.storageSpsOverageGB,
          row.storageVvolOverageGB,
          row.storageOtherOverageGB,
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
      if (parsed.data.vspcPassword === '********') {
        delete parsed.data.vspcPassword;
      }

      const site = await storage.updatePlatformSite(req.params.id, parsed.data);
      if (!site) {
        return res.status(404).json({ error: 'Site not found' });
      }

      platformRegistry.removeSite(existingSite.siteId, existingSite.platformType as PlatformType);
      platformRegistry.addSiteFromConfig(site);
      
      clearVspcClientCache(existingSite.siteId);
      
      log(`Updated platform site: ${site.siteId} (${site.platformType})`, 'routes');
      res.json({ ...site, password: '********', secretKey: site.secretKey ? '********' : null, vspcPassword: site.vspcPassword ? '********' : null });
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
      clearVspcClientCache(existingSite.siteId);
      
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

  // Monitor status endpoints
  app.get('/api/monitor/status', async (req, res) => {
    try {
      const statuses = await getAllMonitorStatuses();
      res.json(statuses);
    } catch (error: any) {
      log(`Error fetching monitor statuses: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/monitor/status/:siteId', async (req, res) => {
    try {
      const { siteId } = req.params;
      const status = await getMonitorStatusForSite(siteId);
      if (!status) {
        return res.json({ siteId, overallStatus: 'unknown', message: 'No monitor data yet' });
      }
      res.json(status);
    } catch (error: any) {
      log(`Error fetching monitor status for ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/monitor/check/:siteId', async (req, res) => {
    try {
      const { siteId } = req.params;
      const status = await triggerMonitorCheck(siteId);
      res.json(status);
    } catch (error: any) {
      log(`Error triggering monitor check for ${req.params.siteId}: ${error.message}`, 'routes');
      res.status(500).json({ error: error.message });
    }
  });

  // Start the monitor service
  startMonitorService();

  return httpServer;
}
