// API client for backend VCD proxy

export interface Site {
  id: string;
  name: string;
  location: string;
  url: string;
  status: 'online' | 'offline' | 'maintenance';
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
 * Fetch all configured VCD sites
 */
export async function fetchSites(): Promise<Site[]> {
  const response = await fetch('/api/sites');
  if (!response.ok) {
    throw new Error('Failed to fetch sites');
  }
  return response.json();
}

/**
 * Fetch all Organization VDCs for a site
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
 * Test connection to a VCD site
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
  cpu: {
    capacity: number;
    allocated: number;
    used: number;
    reserved: number;
    available: number;
    units: string;
  };
  memory: {
    capacity: number;
    allocated: number;
    used: number;
    reserved: number;
    available: number;
    units: string;
  };
  storage: {
    capacity: number;
    limit: number;
    used: number;
    available: number;
    units: string;
  };
  network: {
    totalIps: number;
    usedIps: number;
    freeIps: number;
  };
}

/**
 * Fetch aggregated summary for a VCD site
 */
export async function fetchSiteSummary(siteId: string): Promise<SiteSummary> {
  const response = await fetch(`/api/sites/${siteId}/summary`);
  if (!response.ok) {
    throw new Error(`Failed to fetch summary for site ${siteId}`);
  }
  return response.json();
}
