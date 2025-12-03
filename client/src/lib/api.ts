// API client for multi-platform infrastructure monitoring

export type PlatformType = 'vcd' | 'cloudstack' | 'proxmox';

export interface Site {
  id: string;
  compositeId?: string;
  name: string;
  location: string;
  url: string;
  platformType: PlatformType;
  status: 'online' | 'offline' | 'error' | 'maintenance';
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
  org?: {
    name: string;
    id: string;
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
      return 'VCD';
    case 'cloudstack':
      return 'CloudStack';
    case 'proxmox':
      return 'Proxmox';
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
    default:
      return '#6B7280';
  }
}
