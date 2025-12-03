// VCD 10.6 API-compatible Mock Data Structure

// Common Types
export interface Reference {
  name: string;
  id: string;
  href: string;
  type?: string;
}

// Capacity & Usage Types
export interface CapacityWithUsage {
  Units: string; // 'MHz', 'MB'
  Allocated: number;
  Limit: number;
  Reserved: number;
  Used: number;
  Overhead?: number;
}

export interface ComputeCapacity {
  Cpu: CapacityWithUsage;
  Memory: CapacityWithUsage;
}

// Storage Profile (VCD 10.6 Schema)
export interface VdcStorageProfile {
  id: string; // urn:vcloud:vdcstorageProfile:uuid
  name: string;
  href: string;
  limit: number; // MB
  used: number; // MB
  units: string; // 'MB'
  default: boolean;
  enabled: boolean;
  diskCount?: number; // Optional metric often available in extended views
}

// Compute Policy (VCD 10.6 CloudAPI)
export interface VdcComputePolicy {
  id: string; // urn:vcloud:vdcComputePolicy:uuid
  name: string;
  description?: string;
  cpuSpeed?: number; // MHz
  memory?: number; // MB
  cpuCount?: number;
  coresPerSocket?: number;
}

// Organization VDC (Main Entity)
export interface OrgVdc {
  id: string; // urn:vcloud:vdc:uuid
  name: string;
  description?: string;
  href: string;
  isEnabled: boolean;
  allocationModel: 'AllocationVApp' | 'AllocationPool' | 'ReservationPool' | 'Flex' | 'PayAsYouGo';
  computeCapacity: ComputeCapacity;
  storageProfiles: VdcStorageProfile[];
  vmQuota: number; // -1 for unlimited
  networkQuota: number;
  resourceGuaranteedMemory?: number;
  resourceGuaranteedCpu?: number;
  vcpuInMhz?: number;
  isThinProvision: boolean;
  status: number; // 1=Ready, 0=Creating, etc.
}

// Site (Wrapper for Multi-site Dashboard)
export interface Site {
  id: string;
  name: string;
  location: string;
  url: string; // API Endpoint
  status: 'online' | 'offline' | 'maintenance';
  orgVdcs: OrgVdc[];
}

// --- MOCK DATA GENERATOR ---

export const mockSites: Site[] = [
  {
    id: 'site-ny-01',
    name: 'US-East Primary',
    location: 'New York, NY',
    url: 'https://vcd-ny.example.com',
    status: 'online',
    orgVdcs: [
      {
        id: 'urn:vcloud:vdc:bb039530-82d7-423f-b30d-21727d73401d',
        name: 'Finance-Prod-VDC',
        href: 'https://vcd-ny.example.com/api/vdc/bb039530-82d7-423f-b30d-21727d73401d',
        isEnabled: true,
        allocationModel: 'AllocationPool',
        status: 1,
        vmQuota: 100,
        networkQuota: 20,
        vcpuInMhz: 2400,
        isThinProvision: true,
        computeCapacity: {
          Cpu: {
            Units: 'MHz',
            Allocated: 200000, // 200 GHz bought
            Limit: 200000,
            Reserved: 100000, // 50% guaranteed
            Used: 145000, // Currently using 145 GHz
          },
          Memory: {
            Units: 'MB',
            Allocated: 409600, // 400 GB
            Limit: 409600,
            Reserved: 204800,
            Used: 312000, // ~300 GB used
          }
        },
        storageProfiles: [
          {
            id: 'urn:vcloud:vdcstorageProfile:a1',
            name: 'Gold-SSD-Tier',
            href: '...',
            limit: 5120000, // 5 TB
            used: 3200000, // 3.2 TB
            units: 'MB',
            default: true,
            enabled: true
          },
          {
            id: 'urn:vcloud:vdcstorageProfile:a2',
            name: 'Silver-HDD-Tier',
            href: '...',
            limit: 10240000, // 10 TB
            used: 8500000, // 8.5 TB
            units: 'MB',
            default: false,
            enabled: true
          }
        ]
      },
      {
        id: 'urn:vcloud:vdc:cc049530-92d7-523f-c40d-31727d73402e',
        name: 'HR-Internal-VDC',
        href: 'https://vcd-ny.example.com/api/vdc/cc049530-92d7-523f-c40d-31727d73402e',
        isEnabled: true,
        allocationModel: 'Flex',
        status: 1,
        vmQuota: 50,
        networkQuota: 10,
        vcpuInMhz: 2000,
        isThinProvision: true,
        computeCapacity: {
          Cpu: {
            Units: 'MHz',
            Allocated: 50000, 
            Limit: 50000,
            Reserved: 0,
            Used: 42000, // High usage!
          },
          Memory: {
            Units: 'MB',
            Allocated: 102400,
            Limit: 102400,
            Reserved: 0,
            Used: 89000,
          }
        },
        storageProfiles: [
          {
            id: 'urn:vcloud:vdcstorageProfile:b1',
            name: 'Standard-Performance',
            href: '...',
            limit: 2048000,
            used: 1800000,
            units: 'MB',
            default: true,
            enabled: true
          }
        ]
      }
    ]
  },
  {
    id: 'site-ldn-01',
    name: 'EU-West Hub',
    location: 'London, UK',
    url: 'https://vcd-ldn.example.com',
    status: 'online',
    orgVdcs: [
      {
        id: 'urn:vcloud:vdc:dd059530-02d7-623f-d50d-41727d73403f',
        name: 'DevOps-Lab-VDC',
        href: 'https://vcd-ldn.example.com/api/vdc/dd059530-02d7-623f-d50d-41727d73403f',
        isEnabled: true,
        allocationModel: 'PayAsYouGo', // Or AllocationVApp in older terms
        status: 1,
        vmQuota: -1,
        networkQuota: 50,
        vcpuInMhz: 2600,
        isThinProvision: true,
        computeCapacity: {
          Cpu: {
            Units: 'MHz',
            Allocated: 0, // PAYG often has 0 allocation
            Limit: 0, // Unlimited
            Reserved: 0,
            Used: 65000,
          },
          Memory: {
            Units: 'MB',
            Allocated: 0,
            Limit: 0,
            Reserved: 0,
            Used: 128000,
          }
        },
        storageProfiles: [
          {
            id: 'urn:vcloud:vdcstorageProfile:c1',
            name: 'NvME-Ultra',
            href: '...',
            limit: 1024000,
            used: 450000,
            units: 'MB',
            default: false,
            enabled: true
          },
          {
            id: 'urn:vcloud:vdcstorageProfile:c2',
            name: 'Standard-Performance',
            href: '...',
            limit: 5120000,
            used: 2100000,
            units: 'MB',
            default: true,
            enabled: true
          }
        ]
      }
    ]
  }
];
