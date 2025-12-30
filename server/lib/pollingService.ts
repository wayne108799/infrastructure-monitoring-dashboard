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

interface HighWaterMarkData {
  siteId: string;
  tenantId: string;
  tenantName: string;
  orgName: string | null;
  orgFullName: string | null;
  maxCpuUsedMHz: number;
  maxRamUsedMB: number;
  maxStorageUsedMB: number;
  maxAllocatedIps: number;
  storageTiers: { [tierName: string]: { maxUsedMB: number } };
  snapshotCount: number;
}

export async function getHighWaterMarkForMonth(year: number, month: number): Promise<HighWaterMarkData[]> {
  // Calculate date range for the month
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);
  
  // Get all tenant snapshots for the month
  const snapshots = await db.select()
    .from(tenantPollSnapshots)
    .where(
      and(
        sql`${tenantPollSnapshots.polledAt} >= ${startDate}`,
        sql`${tenantPollSnapshots.polledAt} < ${endDate}`
      )
    );
  
  // Aggregate high water marks per tenant
  const tenantHighWaterMarks = new Map<string, HighWaterMarkData>();
  
  for (const snapshot of snapshots) {
    const key = `${snapshot.siteId}:${snapshot.tenantId}`;
    const allocationData = snapshot.allocationData as Record<string, any> || {};
    
    if (!tenantHighWaterMarks.has(key)) {
      tenantHighWaterMarks.set(key, {
        siteId: snapshot.siteId,
        tenantId: snapshot.tenantId,
        tenantName: allocationData.name || snapshot.tenantId,
        orgName: snapshot.orgName,
        orgFullName: snapshot.orgFullName,
        maxCpuUsedMHz: 0,
        maxRamUsedMB: 0,
        maxStorageUsedMB: 0,
        maxAllocatedIps: 0,
        storageTiers: {},
        snapshotCount: 0,
      });
    }
    
    const hwm = tenantHighWaterMarks.get(key)!;
    hwm.snapshotCount++;
    
    // Update max CPU used
    const cpuUsed = allocationData.cpu?.used || 0;
    if (cpuUsed > hwm.maxCpuUsedMHz) {
      hwm.maxCpuUsedMHz = cpuUsed;
    }
    
    // Update max RAM used
    const ramUsed = allocationData.memory?.used || 0;
    if (ramUsed > hwm.maxRamUsedMB) {
      hwm.maxRamUsedMB = ramUsed;
    }
    
    // Update max storage used
    const storageUsed = allocationData.storage?.used || 0;
    if (storageUsed > hwm.maxStorageUsedMB) {
      hwm.maxStorageUsedMB = storageUsed;
    }
    
    // Update max allocated IPs
    const allocatedIps = allocationData.allocatedIps || 0;
    if (allocatedIps > hwm.maxAllocatedIps) {
      hwm.maxAllocatedIps = allocatedIps;
    }
    
    // Update max per storage tier (normalize to lowercase for consistent aggregation)
    const tiers = allocationData.storage?.tiers || [];
    for (const tier of tiers) {
      const tierName = (tier.name || 'Unknown').toLowerCase();
      if (!hwm.storageTiers[tierName]) {
        hwm.storageTiers[tierName] = { maxUsedMB: 0 };
      }
      const tierUsed = tier.used || 0;
      if (tierUsed > hwm.storageTiers[tierName].maxUsedMB) {
        hwm.storageTiers[tierName].maxUsedMB = tierUsed;
      }
    }
  }
  
  return Array.from(tenantHighWaterMarks.values());
}

export async function getAvailableMonths(): Promise<{ year: number; month: number }[]> {
  const results = await db.select({
    polledAt: tenantPollSnapshots.polledAt,
  })
    .from(tenantPollSnapshots)
    .orderBy(desc(tenantPollSnapshots.polledAt));
  
  const monthsSet = new Set<string>();
  const months: { year: number; month: number }[] = [];
  
  for (const r of results) {
    if (r.polledAt) {
      const year = r.polledAt.getFullYear();
      const month = r.polledAt.getMonth() + 1;
      const key = `${year}-${month}`;
      if (!monthsSet.has(key)) {
        monthsSet.add(key);
        months.push({ year, month });
      }
    }
  }
  
  return months;
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
