// API client for multi-platform infrastructure monitoring

export type PlatformType = 'vcd' | 'cloudstack' | 'proxmox' | 'veeam';

export interface ManagementLinks {
  vcd: string | null;
  vcenter: string | null;
  nsx: string | null;
  aria: string | null;
  veeam: string | null;
}

export interface Site {
  id: string;
  compositeId?: string;
  name: string;
  location: string;
  url: string;
  platformType: PlatformType;
  status: 'online' | 'offline' | 'error' | 'maintenance';
  managementLinks?: ManagementLinks;
}

export interface PollingStatus {
  lastPollTime: string | null;
  pollingIntervalHours: number;
  nextPollTime: string | null;
}

export interface Platform {
  type: PlatformType;
  name: string;
  siteCount: number;
}

export interface TenantAllocation {
  id: string;
  name: string;
  description?: string;
  status: string;
  cpu: ResourceMetrics;
  memory: ResourceMetrics;
  storage: StorageMetrics;
  vmCount: number;
  runningVmCount: number;
  allocatedIps?: number;
}

export interface ResourceMetrics {
  capacity: number;
  allocated: number;
  used: number;
  available: number;
  reserved?: number;
  units: string;
}

export interface StorageMetrics {
  capacity: number;
  limit: number;
  used: number;
  available: number;
  units: string;
}

export interface StorageTier {
  name: string;
  capacity: number;
  limit: number;
  used: number;
  available: number;
  units: string;
  configuredCapacity?: number | null;
  configuredCapacityGB?: number | null;
  hasConfiguredCapacity?: boolean;
}

export interface NetworkMetrics {
  totalIps: number;
  allocatedIps: number;
  usedIps: number;
  freeIps: number;
}

export interface OrgVdc {
  id: string;
  name: string;
  description?: string;
  href?: string;
  isEnabled?: boolean;
  allocationModel?: string;
  allocationType?: string;
  orgName?: string;
  orgFullName?: string;
  org?: {
    name: string;
    id: string;
    displayName?: string;
  };
  computeCapacity?: {
    cpu?: {
      units?: string;
      allocated?: number;
      limit?: number;
      reserved?: number;
      used?: number;
    };
    memory?: {
      units?: string;
      allocated?: number;
      limit?: number;
      reserved?: number;
      used?: number;
    };
  };
  storageProfiles?: Array<{
    id?: string;
    name?: string;
    href?: string;
    limit?: number;
    used?: number;
    units?: string;
    default?: boolean;
    enabled?: boolean;
  }>;
  vmResources?: {
    vmCount?: number;
    runningVmCount?: number;
  };
  ipAllocation?: {
    totalIpCount?: number;
  };
  network?: {
    allocatedIps?: {
      totalIpCount?: number;
      usedIpCount?: number;
      freeIpCount?: number;
      subnets?: Array<{
        gateway?: string;
        netmask?: string;
        primaryIp?: string;
        ipRanges?: Array<{
          startAddress?: string;
          endAddress?: string;
        }>;
      }>;
    };
  };
  status?: number;
  vmQuota?: number;
  networkQuota?: number;
  vcpuInMhz?: number;
  isThinProvision?: boolean;
}

/**
 * Fetch all configured sites across all platforms
 */
export async function fetchSites(platform?: PlatformType): Promise<Site[]> {
  const url = platform ? `/api/sites?platform=${platform}` : '/api/sites';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch sites');
  }
  return response.json();
}

/**
 * Fetch available platforms
 */
export async function fetchPlatforms(): Promise<Platform[]> {
  const response = await fetch('/api/platforms');
  if (!response.ok) {
    throw new Error('Failed to fetch platforms');
  }
  return response.json();
}

/**
 * Fetch all tenants (VDCs, Projects, Nodes) for a site
 */
export async function fetchSiteTenants(siteId: string): Promise<TenantAllocation[]> {
  const response = await fetch(`/api/sites/${siteId}/tenants`);
  if (!response.ok) {
    throw new Error(`Failed to fetch tenants for site ${siteId}`);
  }
  return response.json();
}

/**
 * Fetch all Organization VDCs for a site (legacy, uses tenants endpoint)
 */
export async function fetchSiteVdcs(siteId: string): Promise<OrgVdc[]> {
  const response = await fetch(`/api/sites/${siteId}/vdcs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch VDCs for site ${siteId}`);
  }
  return response.json();
}

/**
 * Fetch comprehensive data for a specific VDC
 */
export async function fetchVdcDetails(siteId: string, vdcId: string): Promise<OrgVdc> {
  const response = await fetch(`/api/sites/${siteId}/vdcs/${vdcId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch VDC ${vdcId}`);
  }
  return response.json();
}

/**
 * Test connection to a site
 */
export async function testSiteConnection(siteId: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch(`/api/sites/${siteId}/test-connection`, {
    method: 'POST',
  });
  return response.json();
}

export interface SiteSummary {
  totalVdcs: number;
  totalVms: number;
  runningVms: number;
  cpu: ResourceMetrics;
  memory: ResourceMetrics;
  storage: StorageMetrics;
  storageTiers?: StorageTier[];
  network: NetworkMetrics;
  platformType?: PlatformType;
}

/**
 * Fetch aggregated summary for a site
 */
export async function fetchSiteSummary(siteId: string): Promise<SiteSummary> {
  const response = await fetch(`/api/sites/${siteId}/summary`);
  if (!response.ok) {
    throw new Error(`Failed to fetch summary for site ${siteId}`);
  }
  return response.json();
}

/**
 * Fetch aggregated summary across all sites
 */
export async function fetchGlobalSummary(platform?: PlatformType): Promise<{
  totals: {
    totalSites: number;
    totalTenants: number;
    totalVms: number;
    runningVms: number;
    cpu: ResourceMetrics;
    memory: ResourceMetrics;
    storage: StorageMetrics;
    network: NetworkMetrics;
    byPlatform: Record<string, { siteCount: number; totalVms: number; runningVms: number }>;
  };
  sites: Array<SiteSummary & { siteName: string; siteId: string }>;
}> {
  const url = platform ? `/api/summary?platform=${platform}` : '/api/summary';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch global summary');
  }
  return response.json();
}

/**
 * Get platform display name
 */
export function getPlatformDisplayName(type: PlatformType): string {
  switch (type) {
    case 'vcd':
      return 'VMware Cloud Director';
    case 'cloudstack':
      return 'Apache CloudStack';
    case 'proxmox':
      return 'Proxmox VE';
    case 'veeam':
      return 'Veeam ONE';
    default:
      return type;
  }
}

/**
 * Get platform short name
 */
export function getPlatformShortName(type: PlatformType): string {
  switch (type) {
    case 'vcd':
      return 'Enterprise Cloud';
    case 'cloudstack':
      return 'VPS/VDS';
    case 'proxmox':
      return 'Other';
    case 'veeam':
      return 'Veeam';
    default:
      return type;
  }
}

/**
 * Get platform color
 */
export function getPlatformColor(type: PlatformType): string {
  switch (type) {
    case 'vcd':
      return '#0091DA'; // VMware blue
    case 'cloudstack':
      return '#F68D2E'; // CloudStack orange
    case 'proxmox':
      return '#E57000'; // Proxmox orange
    case 'veeam':
      return '#00B336'; // Veeam green
    default:
      return '#6B7280';
  }
}

export interface PlatformSiteConfig {
  id: string;
  siteId: string;
  platformType: PlatformType;
  name: string;
  location: string;
  url: string;
  username?: string | null;
  password?: string | null;
  org?: string | null;
  apiKey?: string | null;
  secretKey?: string | null;
  realm?: string | null;
  isEnabled?: boolean | null;
  vcenterUrl?: string | null;
  nsxUrl?: string | null;
  ariaUrl?: string | null;
  veeamUrl?: string | null;
  vspcUrl?: string | null;
  vspcUsername?: string | null;
  vspcPassword?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreatePlatformSiteConfig {
  siteId: string;
  platformType: PlatformType;
  name: string;
  location: string;
  url: string;
  username?: string;
  password?: string;
  org?: string;
  apiKey?: string;
  secretKey?: string;
  realm?: string;
  isEnabled?: boolean;
  vcenterUrl?: string;
  nsxUrl?: string;
  ariaUrl?: string;
  veeamUrl?: string;
  vspcUrl?: string;
  vspcUsername?: string;
  vspcPassword?: string;
}

/**
 * Fetch all configured platform sites
 */
export async function fetchConfiguredSites(): Promise<PlatformSiteConfig[]> {
  const response = await fetch('/api/config/sites');
  if (!response.ok) {
    throw new Error('Failed to fetch configured sites');
  }
  return response.json();
}

/**
 * Create a new platform site configuration
 */
export async function createSiteConfig(config: CreatePlatformSiteConfig): Promise<PlatformSiteConfig> {
  const response = await fetch('/api/config/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create site configuration');
  }
  return response.json();
}

/**
 * Update an existing platform site configuration
 */
export async function updateSiteConfig(id: string, config: Partial<CreatePlatformSiteConfig>): Promise<PlatformSiteConfig> {
  const response = await fetch(`/api/config/sites/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update site configuration');
  }
  return response.json();
}

/**
 * Delete a platform site configuration
 */
export async function deleteSiteConfig(id: string): Promise<void> {
  const response = await fetch(`/api/config/sites/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete site configuration');
  }
}

/**
 * Test connection to a configured site
 */
export async function testSiteConfigConnection(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch(`/api/config/sites/${id}/test`, {
    method: 'POST',
  });
  return response.json();
}

/**
 * Export all tenant allocations as CSV
 * Triggers file download
 */
export async function exportTenantsCSV(): Promise<void> {
  const response = await fetch('/api/export/tenants');
  if (!response.ok) {
    throw new Error('Failed to export tenants');
  }
  
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tenant-export-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export interface HighWaterMarkTenant {
  siteId: string;
  site: string;
  siteLocation: string;
  platform: string;
  tenantId: string;
  tenant: string;
  businessId: string;
  businessName: string;
  vcpu: number;
  cpuUsedMHz: number;
  ramGB: number;
  ramUsedMB: number;
  storageHpsGB: number;
  storageSpsGB: number;
  storageVvolGB: number;
  storageOtherGB: number;
  allocatedIps: number;
  snapshotCount: number;
  commitVcpu: string;
  commitRamGB: string;
  commitHpsGB: string;
  commitSpsGB: string;
  commitVvolGB: string;
  commitOtherGB: string;
  commitIps: string;
  notes: string;
}

export interface HighWaterMarkResponse {
  year: number;
  month: number;
  data: HighWaterMarkTenant[];
}

export interface AvailableMonth {
  year: number;
  month: number;
}

export async function fetchHighWaterMark(year?: number, month?: number): Promise<HighWaterMarkResponse> {
  let url = '/api/report/high-water-mark';
  const params = new URLSearchParams();
  if (year) params.set('year', year.toString());
  if (month) params.set('month', month.toString());
  if (params.toString()) url += '?' + params.toString();
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch high water mark data');
  }
  return response.json();
}

export async function fetchAvailableMonths(): Promise<AvailableMonth[]> {
  const response = await fetch('/api/report/available-months');
  if (!response.ok) {
    throw new Error('Failed to fetch available months');
  }
  return response.json();
}

/**
 * Fetch polling status
 */
export async function fetchPollingStatus(): Promise<PollingStatus> {
  const response = await fetch('/api/polling/status');
  if (!response.ok) {
    throw new Error('Failed to fetch polling status');
  }
  return response.json();
}

/**
 * Trigger a manual poll cycle
 */
export async function triggerPoll(): Promise<{ success: boolean; message: string }> {
  const response = await fetch('/api/polling/trigger', { method: 'POST' });
  if (!response.ok) {
    throw new Error('Failed to trigger poll');
  }
  return response.json();
}

/**
 * Fetch cached site summary from last poll
 */
export async function fetchCachedSiteSummary(siteId: string): Promise<SiteSummary | null> {
  const response = await fetch(`/api/polling/site/${siteId}/summary`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to fetch cached site summary');
  }
  return response.json();
}

/**
 * Fetch site summary - uses cached data only for fast loading
 * Returns null if no cache exists (initial poll still in progress)
 * This prevents slow live API calls on page load
 */
export async function fetchSiteSummaryFast(siteId: string): Promise<SiteSummary | null> {
  // Only use cached data - don't fall back to slow live API
  // If cache is empty, the polling service is still initializing
  return await fetchCachedSiteSummary(siteId);
}

/**
 * Fetch cached tenant allocations from last poll
 */
export async function fetchCachedTenants(siteId: string): Promise<OrgVdc[]> {
  const response = await fetch(`/api/polling/site/${siteId}/tenants`);
  if (!response.ok) {
    throw new Error('Failed to fetch cached tenants');
  }
  return response.json();
}

/**
 * Export all tenant allocations as JSON
 */
export async function exportTenantsJSON(): Promise<any[]> {
  const response = await fetch('/api/export/tenants?format=json');
  if (!response.ok) {
    throw new Error('Failed to export tenants');
  }
  return response.json();
}

// Tenant Commit Levels
export interface TenantCommitLevel {
  id: string;
  siteId: string;
  tenantId: string;
  tenantName: string;
  businessId?: string;
  businessName?: string;
  vcpuCount?: string;
  vcpuSpeedGhz?: string;
  ramGB?: string;
  storageHpsGB?: string;
  storageSpsGB?: string;
  storageVvolGB?: string;
  storageOtherGB?: string;
  allocatedIps?: string;
  notes?: string;
  updatedAt?: string;
}

export interface InsertTenantCommitLevel {
  siteId: string;
  tenantId: string;
  tenantName: string;
  businessId?: string;
  businessName?: string;
  vcpuCount?: string;
  vcpuSpeedGhz?: string;
  ramGB?: string;
  storageHpsGB?: string;
  storageSpsGB?: string;
  storageVvolGB?: string;
  storageOtherGB?: string;
  allocatedIps?: string;
  notes?: string;
}

/**
 * Get all commit levels, optionally filtered by site
 */
export async function fetchCommitLevels(siteId?: string): Promise<TenantCommitLevel[]> {
  const url = siteId ? `/api/commit-levels?siteId=${siteId}` : '/api/commit-levels';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch commit levels');
  }
  return response.json();
}

/**
 * Get a specific tenant's commit level
 */
export async function fetchCommitLevel(siteId: string, tenantId: string): Promise<TenantCommitLevel | null> {
  const response = await fetch(`/api/commit-levels/${siteId}/${tenantId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error('Failed to fetch commit level');
  }
  return response.json();
}

/**
 * Save or update a tenant commit level
 */
export async function saveCommitLevel(level: InsertTenantCommitLevel): Promise<TenantCommitLevel> {
  const response = await fetch('/api/commit-levels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(level),
  });
  if (!response.ok) {
    throw new Error('Failed to save commit level');
  }
  return response.json();
}

/**
 * Delete a tenant commit level
 */
export async function deleteCommitLevel(siteId: string, tenantId: string): Promise<void> {
  const response = await fetch(`/api/commit-levels/${siteId}/${tenantId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete commit level');
  }
}

// Veeam ONE types
export interface VeeamBackupMetrics {
  protectedVmCount: number;
  unprotectedVmCount: number;
  totalVmCount: number;
  protectionPercentage: number;
  lastBackupDate?: string;
}

export interface VeeamRepository {
  id: string;
  name: string;
  capacityGB: number;
  usedSpaceGB: number;
  freeSpaceGB: number;
  usagePercentage: number;
}

export interface VeeamSiteSummary {
  siteId: string;
  siteName: string;
  siteLocation: string;
  platformType: 'veeam';
  backup: VeeamBackupMetrics;
  repositories: VeeamRepository[];
  totalRepositoryCapacityGB: number;
  totalRepositoryUsedGB: number;
  totalRepositoryFreeGB: number;
}

export interface VeeamSummaryResponse {
  configured: boolean;
  message?: string;
  sites: VeeamSiteSummary[];
  totals: {
    protectedVmCount: number;
    unprotectedVmCount: number;
    totalVmCount: number;
    protectionPercentage: number;
    repositoryCapacityGB: number;
    repositoryUsedGB: number;
    repositoryFreeGB: number;
  };
}

/**
 * Fetch Veeam ONE backup summary
 */
export async function fetchVeeamSummary(): Promise<VeeamSummaryResponse> {
  const response = await fetch('/api/veeam/summary');
  if (!response.ok) {
    throw new Error('Failed to fetch Veeam summary');
  }
  return response.json();
}

// Veeam ONE Configuration
export interface VeeamConfig {
  url: string;
  username: string;
  password: string;
  name: string;
  location: string;
  isEnabled: boolean;
}

/**
 * Fetch Veeam ONE configuration
 */
export async function fetchVeeamConfig(): Promise<VeeamConfig> {
  const response = await fetch('/api/veeam/config');
  if (!response.ok) {
    throw new Error('Failed to fetch Veeam config');
  }
  return response.json();
}

/**
 * Save Veeam ONE configuration
 */
export async function saveVeeamConfig(config: VeeamConfig): Promise<{ success: boolean; config: VeeamConfig }> {
  const response = await fetch('/api/veeam/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error('Failed to save Veeam config');
  }
  return response.json();
}

/**
 * Test Veeam ONE connection
 */
export async function testVeeamConnection(config: { url: string; username: string; password: string }): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch('/api/veeam/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error('Failed to test Veeam connection');
  }
  return response.json();
}

// Backup metrics by organization
export interface OrgBackupMetrics {
  orgId?: string;
  orgName?: string;
  protectedVmCount: number;
  totalVmCount: number;
  backupSizeGB: number;
  protectionPercentage?: number;
}

export interface BackupByOrgResponse {
  configured: boolean;
  siteId?: string;
  organizations: Record<string, OrgBackupMetrics>;
}

/**
 * Fetch backup metrics grouped by organization name (legacy Veeam ONE)
 */
export async function fetchBackupByOrg(): Promise<BackupByOrgResponse> {
  const response = await fetch('/api/veeam/backup-by-org');
  if (!response.ok) {
    throw new Error('Failed to fetch backup metrics by org');
  }
  return response.json();
}

/**
 * Fetch VSPC backup metrics for a specific VCD site (keyed by org ID)
 */
export async function fetchVspcBackupByOrg(siteId: string): Promise<BackupByOrgResponse> {
  const response = await fetch(`/api/vspc/${siteId}/backup-by-org`);
  if (!response.ok) {
    throw new Error('Failed to fetch VSPC backup metrics');
  }
  return response.json();
}

/**
 * Test VSPC connection for a VCD site
 */
export async function testVspcConnection(siteId: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const response = await fetch(`/api/vspc/${siteId}/test-connection`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to test VSPC connection');
  }
  return response.json();
}

// Storage capacity configuration
export interface SiteStorageConfig {
  id: string;
  siteId: string;
  tierName: string;
  usableCapacityGB: number;
  updatedAt: string;
}

export interface DiscoveredStorageTier {
  name: string;
  discoveredCapacityMB: number;
  discoveredCapacityGB: number;
  usedMB: number;
  usedGB: number;
  configuredCapacityGB: number | null;
  hasOverride: boolean;
}

export interface DiscoveredStorageResponse {
  siteId: string;
  tiers: DiscoveredStorageTier[];
  platformConnected: boolean;
}

/**
 * Fetch storage configuration for a site
 */
export async function fetchStorageConfig(siteId: string): Promise<SiteStorageConfig[]> {
  const response = await fetch(`/api/config/sites/${siteId}/storage`);
  if (!response.ok) {
    throw new Error('Failed to fetch storage config');
  }
  return response.json();
}

/**
 * Fetch discovered storage tiers with configured overrides merged
 */
export async function fetchDiscoveredStorage(siteId: string): Promise<DiscoveredStorageResponse> {
  const response = await fetch(`/api/config/sites/${siteId}/storage/discovered`);
  if (!response.ok) {
    throw new Error('Failed to fetch discovered storage');
  }
  return response.json();
}

/**
 * Save storage capacity for a tier
 */
export async function saveStorageConfig(siteId: string, tierName: string, usableCapacityGB: number): Promise<SiteStorageConfig> {
  const response = await fetch(`/api/config/sites/${siteId}/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tierName, usableCapacityGB }),
  });
  if (!response.ok) {
    throw new Error('Failed to save storage config');
  }
  return response.json();
}

/**
 * Delete storage configuration for a tier
 */
export async function deleteStorageConfig(siteId: string, tierName: string): Promise<void> {
  const response = await fetch(`/api/config/sites/${siteId}/storage/${encodeURIComponent(tierName)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete storage config');
  }
}

/**
 * Fetch all storage configs across all sites
 */
export async function fetchAllStorageConfigs(): Promise<Record<string, SiteStorageConfig[]>> {
  const sites = await fetchConfiguredSites();
  const result: Record<string, SiteStorageConfig[]> = {};
  
  for (const site of sites) {
    try {
      const configs = await fetchStorageConfig(site.siteId);
      if (configs.length > 0) {
        result[site.siteId] = configs;
      }
    } catch (e) {
      // Ignore errors for individual sites
    }
  }
  
  return result;
}
