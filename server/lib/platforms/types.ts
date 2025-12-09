// Unified Platform Interface for VCD, CloudStack, and Proxmox

export type PlatformType = 'vcd' | 'cloudstack' | 'proxmox';

export interface PlatformConfig {
  type: PlatformType;
  id: string;
  name: string;
  location: string;
  url: string;
  username: string;
  password: string;
  apiKey?: string;      // For CloudStack
  secretKey?: string;   // For CloudStack
  realm?: string;       // For Proxmox (e.g., 'pam', 'pve')
  org?: string;         // For VCD
}

export interface ResourceMetrics {
  capacity: number;
  allocated: number;
  used: number;
  available: number;
  reserved?: number;
  units: string;
}

export interface NetworkMetrics {
  totalIps: number;
  allocatedIps: number;
  usedIps: number;
  freeIps: number;
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
}

export interface TenantAllocation {
  id: string;
  name: string;
  description?: string;
  status: string;
  cpu: ResourceMetrics;
  memory: ResourceMetrics;
  storage: StorageMetrics;
  storageTiers?: StorageTier[];  // Breakdown by storage tier/profile
  vmCount: number;
  runningVmCount: number;
  allocatedIps?: number;
}

export interface SiteSummary {
  siteId: string;
  platformType: PlatformType;
  totalTenants: number;  // VDCs in VCD, Projects in CloudStack, VMs groups in Proxmox
  totalVms: number;
  runningVms: number;
  cpu: ResourceMetrics;
  memory: ResourceMetrics;
  storage: StorageMetrics;
  storageTiers?: StorageTier[];  // Breakdown by storage tier/profile
  network: NetworkMetrics;
}

export interface SiteInfo {
  id: string;
  name: string;
  location: string;
  url: string;
  platformType: PlatformType;
  status: 'online' | 'offline' | 'error';
}

/**
 * Unified Platform Client Interface
 * All platform implementations (VCD, CloudStack, Proxmox) must implement this interface
 */
export interface PlatformClient {
  /**
   * Get the platform type
   */
  getPlatformType(): PlatformType;

  /**
   * Get site information
   */
  getSiteInfo(): SiteInfo;

  /**
   * Authenticate with the platform
   */
  authenticate(): Promise<void>;

  /**
   * Test connection to the platform
   */
  testConnection(): Promise<boolean>;

  /**
   * Get aggregated site summary (total resources across all tenants/projects)
   */
  getSiteSummary(): Promise<SiteSummary>;

  /**
   * Get list of tenant allocations (VDCs, Projects, or VM groups)
   */
  getTenantAllocations(): Promise<TenantAllocation[]>;

  /**
   * Get detailed tenant allocation by ID
   */
  getTenantAllocation(tenantId: string): Promise<TenantAllocation | null>;
}
