import { log } from '../../index';
import type { 
  PlatformClient, 
  PlatformConfig, 
  SiteInfo, 
  SiteSummary, 
  TenantAllocation,
  ResourceMetrics,
  StorageMetrics,
  NetworkMetrics
} from './types';
import crypto from 'crypto';

/**
 * CloudStack API Client
 * Uses signature-based authentication with API key and secret key
 */
export class CloudStackClient implements PlatformClient {
  private config: PlatformConfig;
  private authenticated: boolean = false;

  constructor(config: PlatformConfig) {
    this.config = {
      ...config,
      url: config.url.replace(/\/$/, ''),
    };
  }

  getPlatformType(): 'cloudstack' {
    return 'cloudstack';
  }

  getSiteInfo(): SiteInfo {
    return {
      id: this.config.id,
      name: this.config.name,
      location: this.config.location,
      url: this.config.url,
      platformType: 'cloudstack',
      status: 'online',
    };
  }

  /**
   * Generate CloudStack API signature
   * CloudStack requires: sort params by lowercase key, sign with lowercase keys but original-case values
   */
  private generateSignature(params: Record<string, string>): string {
    // Sort parameters alphabetically by lowercase key name
    // Signature string uses lowercase keys but preserves original value case
    const sortedParams = Object.keys(params)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(key => `${key.toLowerCase()}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    // Create HMAC-SHA1 signature
    const hmac = crypto.createHmac('sha1', this.config.secretKey || '');
    hmac.update(sortedParams);
    return hmac.digest('base64');
  }

  /**
   * Make an API request to CloudStack
   */
  private async request<T>(command: string, params: Record<string, string> = {}): Promise<T> {
    const apiKey = this.config.apiKey || '';
    const allParams: Record<string, string> = {
      ...params,
      command,
      apikey: apiKey,
      response: 'json',
    };

    const signature = this.generateSignature(allParams);
    allParams.signature = signature;

    const queryString = Object.entries(allParams)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');

    const url = `${this.config.url}/client/api?${queryString}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`CloudStack API error: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      log(`CloudStack API request failed: ${error}`, 'cloudstack-client');
      throw error;
    }
  }

  async authenticate(): Promise<void> {
    try {
      // Test authentication by listing zones
      await this.request('listZones', {});
      this.authenticated = true;
      log('CloudStack authentication successful', 'cloudstack-client');
    } catch (error) {
      log(`CloudStack authentication failed: ${error}`, 'cloudstack-client');
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }

  async getSiteSummary(): Promise<SiteSummary> {
    try {
      // Fetch capacity data from multiple endpoints
      const [zonesRes, hostsRes, storageRes, publicIpsRes] = await Promise.all([
        this.request<any>('listZones', {}),
        this.request<any>('listHosts', { type: 'Routing' }),
        this.request<any>('listStoragePools', {}),
        this.request<any>('listPublicIpAddresses', {}),
      ]);

      const zones = zonesRes.listzonesresponse?.zone || [];
      const hosts = hostsRes.listhostsresponse?.host || [];
      const storagePools = storageRes.liststoragepoolsresponse?.storagepool || [];
      const publicIps = publicIpsRes.listpublicipaddressesresponse?.publicipaddress || [];

      // Aggregate CPU and memory from hosts
      let cpuCapacity = 0, cpuAllocated = 0, cpuUsed = 0;
      let memoryCapacity = 0, memoryAllocated = 0, memoryUsed = 0;

      for (const host of hosts) {
        cpuCapacity += (host.cpunumber || 0) * (host.cpuspeed || 0);
        cpuAllocated += host.cpuallocated ? parseFloat(host.cpuallocated) / 100 * cpuCapacity : 0;
        cpuUsed += host.cpuused ? parseFloat(host.cpuused) / 100 * cpuCapacity : 0;
        
        memoryCapacity += host.memorytotal || 0;
        memoryAllocated += host.memoryallocated || 0;
        memoryUsed += host.memoryused || 0;
      }

      // Convert memory from bytes to MB
      memoryCapacity = Math.round(memoryCapacity / (1024 * 1024));
      memoryAllocated = Math.round(memoryAllocated / (1024 * 1024));
      memoryUsed = Math.round(memoryUsed / (1024 * 1024));

      // Aggregate storage
      let storageCapacity = 0, storageUsed = 0;
      for (const pool of storagePools) {
        storageCapacity += pool.disksizetotal || 0;
        storageUsed += pool.disksizeused || 0;
      }
      // Convert bytes to MB
      storageCapacity = Math.round(storageCapacity / (1024 * 1024));
      storageUsed = Math.round(storageUsed / (1024 * 1024));

      // Count IPs
      const totalIps = publicIps.length;
      const allocatedIps = publicIps.filter((ip: any) => ip.allocated).length;
      const usedIps = publicIps.filter((ip: any) => ip.virtualmachineid).length;

      // Count VMs
      const vmsRes = await this.request<any>('listVirtualMachines', { listall: 'true' });
      const vms = vmsRes.listvirtualmachinesresponse?.virtualmachine || [];
      const runningVms = vms.filter((vm: any) => vm.state === 'Running').length;

      // Count projects/accounts as tenants
      const projectsRes = await this.request<any>('listProjects', { listall: 'true' });
      const projects = projectsRes.listprojectsresponse?.project || [];

      return {
        siteId: this.config.id,
        platformType: 'cloudstack',
        totalTenants: projects.length || 1,
        totalVms: vms.length,
        runningVms,
        cpu: {
          capacity: Math.round(cpuCapacity),
          allocated: Math.round(cpuAllocated),
          used: Math.round(cpuUsed),
          available: Math.round(cpuCapacity - cpuAllocated),
          units: 'MHz',
        },
        memory: {
          capacity: memoryCapacity,
          allocated: memoryAllocated,
          used: memoryUsed,
          available: memoryCapacity - memoryAllocated,
          units: 'MB',
        },
        storage: {
          capacity: storageCapacity,
          limit: storageCapacity,
          used: storageUsed,
          available: storageCapacity - storageUsed,
          units: 'MB',
        },
        network: {
          totalIps,
          allocatedIps,
          usedIps,
          freeIps: totalIps - allocatedIps,
        },
      };
    } catch (error) {
      log(`Error fetching CloudStack site summary: ${error}`, 'cloudstack-client');
      throw error;
    }
  }

  async getTenantAllocations(): Promise<TenantAllocation[]> {
    try {
      // Get projects as tenants
      const projectsRes = await this.request<any>('listProjects', { listall: 'true' });
      const projects = projectsRes.listprojectsresponse?.project || [];

      const allocations: TenantAllocation[] = [];

      for (const project of projects) {
        try {
          const allocation = await this.getTenantAllocation(project.id);
          if (allocation) {
            allocations.push(allocation);
          }
        } catch (e) {
          log(`Error fetching project allocation: ${e}`, 'cloudstack-client');
        }
      }

      // If no projects, return a default allocation representing the whole cloud
      if (allocations.length === 0) {
        const summary = await this.getSiteSummary();
        allocations.push({
          id: 'default',
          name: 'Default Resources',
          status: 'active',
          cpu: summary.cpu,
          memory: summary.memory,
          storage: summary.storage,
          vmCount: summary.totalVms,
          runningVmCount: summary.runningVms,
          allocatedIps: summary.network.allocatedIps,
        });
      }

      return allocations;
    } catch (error) {
      log(`Error fetching CloudStack tenant allocations: ${error}`, 'cloudstack-client');
      throw error;
    }
  }

  async getTenantAllocation(tenantId: string): Promise<TenantAllocation | null> {
    try {
      // Get project details
      const projectRes = await this.request<any>('listProjects', { id: tenantId });
      const project = projectRes.listprojectsresponse?.project?.[0];

      if (!project) {
        return null;
      }

      // Get VMs for this project
      const vmsRes = await this.request<any>('listVirtualMachines', { projectid: tenantId, listall: 'true' });
      const vms = vmsRes.listvirtualmachinesresponse?.virtualmachine || [];

      // Calculate resource usage from VMs
      let cpuUsed = 0, memoryUsed = 0;
      let runningVmCount = 0;

      for (const vm of vms) {
        if (vm.state === 'Running') {
          cpuUsed += (vm.cpunumber || 0) * (vm.cpuspeed || 0);
          memoryUsed += vm.memory || 0;
          runningVmCount++;
        }
      }

      // Get project limits/quotas
      const cpuLimit = project.cputotal || 0;
      const memoryLimit = project.memorytotal || 0;
      const storageLimit = project.primarystoragetotal || 0;

      return {
        id: project.id,
        name: project.name || project.displaytext || 'Unknown Project',
        description: project.displaytext,
        status: project.state || 'active',
        cpu: {
          capacity: cpuLimit * 1000, // Convert to MHz (assuming 1GHz per core)
          allocated: cpuUsed,
          used: cpuUsed,
          available: (cpuLimit * 1000) - cpuUsed,
          units: 'MHz',
        },
        memory: {
          capacity: memoryLimit,
          allocated: memoryUsed,
          used: memoryUsed,
          available: memoryLimit - memoryUsed,
          units: 'MB',
        },
        storage: {
          capacity: storageLimit,
          limit: storageLimit,
          used: project.primarystorageavailable ? storageLimit - project.primarystorageavailable : 0,
          available: project.primarystorageavailable || storageLimit,
          units: 'MB',
        },
        vmCount: vms.length,
        runningVmCount,
        allocatedIps: project.iptotal || 0,
      };
    } catch (error) {
      log(`Error fetching CloudStack tenant allocation: ${error}`, 'cloudstack-client');
      return null;
    }
  }
}
