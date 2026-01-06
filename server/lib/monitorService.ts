import { storage } from '../storage';
import { checkVCenterHealth, getVCenterTriggeredAlarms } from './vcenterClient';
import type { InsertSiteMonitorStatus } from '@shared/schema';
import https from 'https';

const agent = new https.Agent({
  rejectUnauthorized: false
});

let monitorInterval: NodeJS.Timeout | null = null;
const MONITOR_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function log(message: string) {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [monitor-service] ${message}`);
}

async function checkUrlHealth(url: string): Promise<{ status: 'ok' | 'error'; responseTime: number; error?: string }> {
  if (!url) {
    return { status: 'error', responseTime: 0, error: 'URL not configured' };
  }

  // Ensure URL has protocol prefix
  let fullUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    fullUrl = `https://${url}`;
  }

  const startTime = Date.now();
  
  try {
    const response = await fetch(fullUrl, {
      method: 'HEAD',
      // @ts-ignore
      agent,
      signal: AbortSignal.timeout(10000),
    });
    
    const responseTime = Date.now() - startTime;
    
    if (response.ok || response.status === 302 || response.status === 301 || response.status === 200) {
      return { status: 'ok', responseTime };
    }
    
    return { status: 'error', responseTime, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { status: 'error', responseTime: Date.now() - startTime, error: error.message };
  }
}

async function checkSiteHealth(siteId: string): Promise<InsertSiteMonitorStatus> {
  const site = await storage.getPlatformSiteBySiteId(siteId);
  
  if (!site) {
    return {
      siteId,
      overallStatus: 'unknown',
      lastError: 'Site not found',
    };
  }

  const now = new Date();
  const status: InsertSiteMonitorStatus = {
    siteId,
    vcdLastCheck: now,
    vcenterLastCheck: now,
    nsxLastCheck: now,
    alarmsLastCheck: now,
  };

  let hasError = false;
  let hasCriticalAlarm = false;
  let hasWarning = false;

  // Check VCD URL
  if (site.url) {
    const vcdCheck = await checkUrlHealth(site.url);
    status.vcdStatus = vcdCheck.status;
    status.vcdResponseTime = vcdCheck.responseTime;
    if (vcdCheck.status === 'error') {
      hasError = true;
      log(`VCD check failed for ${siteId}: ${vcdCheck.error}`);
    }
  } else {
    status.vcdStatus = 'unknown';
  }

  // Check vCenter URL
  if (site.vcenterUrl) {
    const vcenterCheck = await checkVCenterHealth(site.vcenterUrl);
    status.vcenterStatus = vcenterCheck.status;
    status.vcenterResponseTime = vcenterCheck.responseTime;
    if (vcenterCheck.status === 'error') {
      hasError = true;
      log(`vCenter check failed for ${siteId}: ${vcenterCheck.error}`);
    }

    // Get vCenter alarms if credentials are available
    if (site.vcenterUsername && site.vcenterPassword) {
      try {
        const alarmData = await getVCenterTriggeredAlarms(
          site.vcenterUrl,
          site.vcenterUsername,
          site.vcenterPassword
        );
        status.criticalAlarmCount = alarmData.criticalCount;
        status.warningAlarmCount = alarmData.warningCount;
        status.alarmDetails = alarmData.alarms;
        
        if (alarmData.criticalCount > 0) {
          hasCriticalAlarm = true;
        }
        if (alarmData.warningCount > 0) {
          hasWarning = true;
        }
      } catch (error: any) {
        log(`vCenter alarm fetch failed for ${siteId}: ${error.message}`);
        status.lastError = `Alarm fetch failed: ${error.message}`;
      }
    }
  } else {
    status.vcenterStatus = 'unknown';
  }

  // Check NSX URL
  if (site.nsxUrl) {
    const nsxCheck = await checkUrlHealth(site.nsxUrl);
    status.nsxStatus = nsxCheck.status;
    status.nsxResponseTime = nsxCheck.responseTime;
    if (nsxCheck.status === 'error') {
      hasError = true;
      log(`NSX check failed for ${siteId}: ${nsxCheck.error}`);
    }
  } else {
    status.nsxStatus = 'unknown';
  }

  // Determine overall status
  if (hasCriticalAlarm || hasError) {
    status.overallStatus = 'critical';
  } else if (hasWarning) {
    status.overallStatus = 'warning';
  } else {
    status.overallStatus = 'healthy';
  }

  return status;
}

export async function runMonitorCycle(): Promise<void> {
  log('Starting monitor cycle...');
  
  try {
    const sites = await storage.getAllPlatformSites();
    const vcdSites = sites.filter(s => s.platformType === 'vcd' && s.isEnabled);
    
    for (const site of vcdSites) {
      try {
        const status = await checkSiteHealth(site.siteId);
        await storage.upsertMonitorStatus(status);
        log(`Checked ${site.siteId}: ${status.overallStatus}`);
      } catch (error: any) {
        log(`Error checking ${site.siteId}: ${error.message}`);
      }
    }
    
    log('Monitor cycle complete');
  } catch (error: any) {
    log(`Monitor cycle error: ${error.message}`);
  }
}

export function startMonitorService(intervalMs: number = MONITOR_INTERVAL_MS): void {
  log(`Starting monitor service (interval: ${intervalMs / 1000}s)`);
  
  // Run immediately
  runMonitorCycle().catch(console.error);
  
  // Schedule periodic runs
  monitorInterval = setInterval(() => {
    runMonitorCycle().catch(console.error);
  }, intervalMs);
}

export function stopMonitorService(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    log('Monitor service stopped');
  }
}

export async function getMonitorStatusForSite(siteId: string): Promise<any> {
  return storage.getMonitorStatus(siteId);
}

export async function getAllMonitorStatuses(): Promise<any[]> {
  return storage.getAllMonitorStatuses();
}

export async function triggerMonitorCheck(siteId: string): Promise<InsertSiteMonitorStatus> {
  const status = await checkSiteHealth(siteId);
  await storage.upsertMonitorStatus(status);
  return status;
}
