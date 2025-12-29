import { db } from '../db';
import { sitePollSnapshots, tenantPollSnapshots, type TenantPollSnapshot } from '@shared/schema';
import { platformRegistry } from './platforms';
import { log } from '../index';
import { sql, desc, eq, lt, and } from 'drizzle-orm';

const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const RETENTION_DAYS = 30;

let pollIntervalId: NodeJS.Timeout | null = null;
let isPolling = false;

export async function pollAllSites(): Promise<void> {
  // Prevent overlapping polls
  if (isPolling) {
    log('Poll already in progress, skipping', 'polling');
    return;
  }
  
  isPolling = true;
  const polledAt = new Date();
  
  try {
    log(`Starting poll cycle at ${polledAt.toISOString()}`, 'polling');
    
    const allClients = platformRegistry.getAllClients();
    
    for (const [siteId, client] of Array.from(allClients.entries())) {
      try {
        const platformType = client.getPlatformType();
        
        // Skip Veeam for now - it's a separate system
        if (platformType === 'veeam') continue;
        
        log(`Polling site ${siteId} (${platformType})...`, 'polling');
        
        // Get site summary and tenants
        const summary = await client.getSiteSummary();
        const tenants = await client.getTenantAllocations();
        
        // Store site snapshot
        await db.insert(sitePollSnapshots).values({
          siteId,
          platformType,
          polledAt,
          totalTenants: summary.totalTenants || 0,
          totalVms: summary.totalVms || 0,
          runningVms: summary.runningVms || 0,
          summaryData: summary as any,
        });
        
        // Store tenant snapshots (batch insert)
        if (tenants.length > 0) {
          const tenantValues = tenants.map(tenant => ({
            siteId,
            tenantId: tenant.id,
            orgName: tenant.orgName || null,
            orgFullName: tenant.orgFullName || null,
            polledAt,
            vmCount: tenant.vmCount || 0,
            runningVmCount: tenant.runningVmCount || 0,
            allocationData: tenant as any,
          }));
          
          await db.insert(tenantPollSnapshots).values(tenantValues);
        }
        
        log(`Polled site ${siteId}: ${tenants.length} tenants`, 'polling');
      } catch (error: any) {
        log(`Error polling site ${siteId}: ${error.message}`, 'polling');
      }
    }
    
    log(`Poll cycle complete`, 'polling');
  } finally {
    isPolling = false;
  }
}

export async function pruneOldSnapshots(): Promise<void> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
  
  try {
    const siteResult = await db.delete(sitePollSnapshots)
      .where(lt(sitePollSnapshots.polledAt, cutoffDate));
    
    const tenantResult = await db.delete(tenantPollSnapshots)
      .where(lt(tenantPollSnapshots.polledAt, cutoffDate));
    
    log(`Pruned snapshots older than ${RETENTION_DAYS} days`, 'polling');
  } catch (error: any) {
    log(`Error pruning old snapshots: ${error.message}`, 'polling');
  }
}

export async function getLatestSiteSummary(siteId: string): Promise<any | null> {
  const results = await db.select()
    .from(sitePollSnapshots)
    .where(eq(sitePollSnapshots.siteId, siteId))
    .orderBy(desc(sitePollSnapshots.polledAt))
    .limit(1);
  
  if (results.length === 0) return null;
  
  const snapshot = results[0];
  const summaryData = snapshot.summaryData as Record<string, any> || {};
  return {
    ...summaryData,
    polledAt: snapshot.polledAt,
  };
}

export async function getLatestTenantAllocations(siteId: string): Promise<any[]> {
  // Get the latest polledAt for this site
  const latestPoll = await db.select({ polledAt: tenantPollSnapshots.polledAt })
    .from(tenantPollSnapshots)
    .where(eq(tenantPollSnapshots.siteId, siteId))
    .orderBy(desc(tenantPollSnapshots.polledAt))
    .limit(1);
  
  if (latestPoll.length === 0) return [];
  
  // Get all tenants from that poll
  const results = await db.select()
    .from(tenantPollSnapshots)
    .where(sql`${tenantPollSnapshots.siteId} = ${siteId} AND ${tenantPollSnapshots.polledAt} = ${latestPoll[0].polledAt}`);
  
  return results.map((r: TenantPollSnapshot) => {
    const allocationData = r.allocationData as Record<string, any> || {};
    return {
      ...allocationData,
      polledAt: r.polledAt,
    };
  });
}

export async function getLastPollTime(): Promise<Date | null> {
  const results = await db.select({ polledAt: sitePollSnapshots.polledAt })
    .from(sitePollSnapshots)
    .orderBy(desc(sitePollSnapshots.polledAt))
    .limit(1);
  
  return results.length > 0 ? results[0].polledAt : null;
}

export function startPollingService(): void {
  if (pollIntervalId) {
    log('Polling service already running', 'polling');
    return;
  }
  
  log(`Starting polling service (interval: ${POLL_INTERVAL_MS / 1000 / 60} minutes)`, 'polling');
  
  // Run initial poll after a short delay (let servers stabilize)
  setTimeout(async () => {
    await pollAllSites();
    await pruneOldSnapshots();
  }, 10000);
  
  // Set up recurring poll
  pollIntervalId = setInterval(async () => {
    await pollAllSites();
    await pruneOldSnapshots();
  }, POLL_INTERVAL_MS);
}

export function stopPollingService(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    log('Polling service stopped', 'polling');
  }
}
