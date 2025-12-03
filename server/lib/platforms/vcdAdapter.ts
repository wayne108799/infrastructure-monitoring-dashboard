import { log } from '../../index';
import type { 
  PlatformClient, 
  PlatformConfig, 
  SiteInfo, 
  SiteSummary, 
  TenantAllocation 
} from './types';
import { VcdClient, type VcdConfig } from '../vcdClient';

/**
 * VCD Adapter - Wraps the existing VcdClient to implement PlatformClient interface
 */
export class VcdAdapter implements PlatformClient {
  private config: PlatformConfig;
  private client: VcdClient;

  constructor(config: PlatformConfig) {
    this.config = config;
    
    const vcdConfig: VcdConfig = {
      url: config.url,
      username: config.username,
      password: config.password,
      org: config.org || 'System',
    };
    
    this.client = new VcdClient(vcdConfig);
  }

  getPlatformType(): 'vcd' {
    return 'vcd';
  }

  getSiteInfo(): SiteInfo {
    return {
      id: this.config.id,
      name: this.config.name,
      location: this.config.location,
      url: this.config.url,
      platformType: 'vcd',
      status: 'online',
    };
  }

  async authenticate(): Promise<void> {
    await this.client.authenticate();
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.authenticate();
      return true;
    } catch {
      return false;
    }
  }

  async getSiteSummary(): Promise<SiteSummary> {
    try {
      // Fetch VDCs, Provider capacity, and Site IP summary in parallel
      const [vdcs, providerCapacity, siteIpSummary] = await Promise.all([
        this.client.getOrgVdcs(),
        this.client.getProviderCapacity(),
        this.client.getSiteIpSummary()
      ]);
      
      // Fetch comprehensive data for each VDC (in parallel)
      const comprehensiveVdcs = await Promise.all(
        vdcs.map(async (vdc) => {
          try {
            return await this.client.getVdcComprehensive(vdc.id);
          } catch (error: any) {
            return vdc;
          }
        })
      );

      // Aggregate totals from Org VDCs
      let totalVms = 0, runningVms = 0;
      let cpuAllocated = 0, cpuUsed = 0, cpuReserved = 0;
      let memoryAllocated = 0, memoryUsed = 0, memoryReserved = 0;
      let storageLimit = 0, storageUsed = 0;

      for (const vdc of comprehensiveVdcs) {
        if (vdc.vmResources) {
          totalVms += vdc.vmResources.vmCount || 0;
          runningVms += vdc.vmResources.runningVmCount || 0;
        }
        
        if (vdc.computeCapacity) {
          cpuAllocated += vdc.computeCapacity.cpu?.allocated || 0;
          cpuUsed += vdc.computeCapacity.cpu?.used || 0;
          cpuReserved += vdc.computeCapacity.cpu?.reserved || 0;
          memoryAllocated += vdc.computeCapacity.memory?.allocated || 0;
          memoryUsed += vdc.computeCapacity.memory?.used || 0;
          memoryReserved += vdc.computeCapacity.memory?.reserved || 0;
        }
        
        if (vdc.storageProfiles && Array.isArray(vdc.storageProfiles)) {
          for (const profile of vdc.storageProfiles) {
            storageLimit += profile.limit || 0;
            storageUsed += profile.used || 0;
          }
        }
      }

      // Calculate capacities
      let cpuCapacity = providerCapacity.cpu.capacity || cpuAllocated;
      let memoryCapacity = providerCapacity.memory.capacity || memoryAllocated;
      let storageCapacity = providerCapacity.storage.capacity || storageLimit;

      return {
        siteId: this.config.id,
        platformType: 'vcd',
        totalTenants: comprehensiveVdcs.length,
        totalVms,
        runningVms,
        cpu: {
          capacity: cpuCapacity,
          allocated: cpuAllocated,
          used: cpuUsed,
          reserved: cpuReserved,
          available: cpuCapacity - cpuAllocated,
          units: 'MHz',
        },
        memory: {
          capacity: memoryCapacity,
          allocated: memoryAllocated,
          used: memoryUsed,
          reserved: memoryReserved,
          available: memoryCapacity - memoryAllocated,
          units: 'MB',
        },
        storage: {
          capacity: storageCapacity,
          limit: storageLimit,
          used: storageUsed,
          available: storageCapacity - storageUsed,
          units: 'MB',
        },
        network: {
          totalIps: siteIpSummary.totalIps,
          allocatedIps: siteIpSummary.allocatedIps,
          usedIps: siteIpSummary.usedIps,
          freeIps: siteIpSummary.freeIps,
        },
      };
    } catch (error) {
      log(`Error fetching VCD site summary: ${error}`, 'vcd-adapter');
      throw error;
    }
  }

  async getTenantAllocations(): Promise<TenantAllocation[]> {
    try {
      const vdcs = await this.client.getOrgVdcs();
      
      const allocations: TenantAllocation[] = await Promise.all(
        vdcs.map(async (vdc) => {
          try {
            const comprehensive = await this.client.getVdcComprehensive(vdc.id);
            return this.mapVdcToTenantAllocation(comprehensive);
          } catch (error) {
            return this.mapVdcToTenantAllocation(vdc);
          }
        })
      );

      return allocations;
    } catch (error) {
      log(`Error fetching VCD tenant allocations: ${error}`, 'vcd-adapter');
      throw error;
    }
  }

  async getTenantAllocation(tenantId: string): Promise<TenantAllocation | null> {
    try {
      const vdc = await this.client.getVdcComprehensive(tenantId);
      return this.mapVdcToTenantAllocation(vdc);
    } catch (error) {
      log(`Error fetching VCD tenant allocation: ${error}`, 'vcd-adapter');
      return null;
    }
  }

  private mapVdcToTenantAllocation(vdc: any): TenantAllocation {
    // Calculate storage totals
    let storageCapacity = 0, storageUsed = 0;
    if (vdc.storageProfiles && Array.isArray(vdc.storageProfiles)) {
      for (const profile of vdc.storageProfiles) {
        storageCapacity += profile.limit || 0;
        storageUsed += profile.used || 0;
      }
    }

    return {
      id: vdc.id,
      name: vdc.name,
      description: vdc.description,
      status: vdc.status === 1 ? 'active' : 'inactive',
      cpu: {
        capacity: vdc.computeCapacity?.cpu?.limit || vdc.computeCapacity?.cpu?.allocated || 0,
        allocated: vdc.computeCapacity?.cpu?.allocated || 0,
        used: vdc.computeCapacity?.cpu?.used || 0,
        reserved: vdc.computeCapacity?.cpu?.reserved || 0,
        available: (vdc.computeCapacity?.cpu?.allocated || 0) - (vdc.computeCapacity?.cpu?.used || 0),
        units: 'MHz',
      },
      memory: {
        capacity: vdc.computeCapacity?.memory?.limit || vdc.computeCapacity?.memory?.allocated || 0,
        allocated: vdc.computeCapacity?.memory?.allocated || 0,
        used: vdc.computeCapacity?.memory?.used || 0,
        reserved: vdc.computeCapacity?.memory?.reserved || 0,
        available: (vdc.computeCapacity?.memory?.allocated || 0) - (vdc.computeCapacity?.memory?.used || 0),
        units: 'MB',
      },
      storage: {
        capacity: storageCapacity,
        limit: storageCapacity,
        used: storageUsed,
        available: storageCapacity - storageUsed,
        units: 'MB',
      },
      vmCount: vdc.vmResources?.vmCount || 0,
      runningVmCount: vdc.vmResources?.runningVmCount || 0,
      allocatedIps: vdc.ipAllocation?.totalIpCount || 0,
    };
  }
}
