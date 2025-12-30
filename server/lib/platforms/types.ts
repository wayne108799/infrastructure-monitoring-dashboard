// Unified Platform Interface for VCD, CloudStack, Proxmox, and Veeam ONE

export type PlatformType = 'vcd' | 'cloudstack' | 'proxmox' | 'veeam';

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
  orgName?: string;       // Organization/business ID (short name)
  orgFullName?: string;   // Organization full display name (customer name)
  description?: string;
  status: string;
  allocationType?: string; // VDC allocation model (AllocationVApp, AllocationPool, ReservationPool, Flex)
  cpu: ResourceMetrics;
  memory: ResourceMetrics;
  storage: StorageMetrics;
  storageTiers?: StorageTier[];  // Breakdown by storage tier/profile
  vmCount: number;
  runningVmCount: number;
  allocatedIps?: number;
  ipAllocation?: {
    totalIpCount: number;
    usedIpCount: number;
    freeIpCount: number;
  };
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

// Veeam ONE specific types
export interface BackupMetrics {
  protectedVmCount: number;
  unprotectedVmCount: number;
  totalVmCount: number;
  protectionPercentage: number;
  lastBackupDate?: string;
}

export interface BackupRepository {
  id: string;
  name: string;
  capacityGB: number;
  usedSpaceGB: number;
  freeSpaceGB: number;
  usagePercentage: number;
}

export interface VeeamSiteSummary {
  siteId: string;
  platformType: 'veeam';
  backup: BackupMetrics;
  repositories: BackupRepository[];
  totalRepositoryCapacityGB: number;
  totalRepositoryUsedGB: number;
  totalRepositoryFreeGB: number;
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
