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

interface ProxmoxTicket {
  ticket: string;
  CSRFPreventionToken: string;
  expiresAt: number;
}

/**
 * Proxmox VE API Client
 * Uses ticket-based authentication
 */
export class ProxmoxClient implements PlatformClient {
  private config: PlatformConfig;
  private ticket: ProxmoxTicket | null = null;

  constructor(config: PlatformConfig) {
    // Ensure URL has protocol and no trailing slash
    let url = config.url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    url = url.replace(/\/$/, '');

    this.config = {
      ...config,
      url,
      realm: config.realm || 'pam',
    };
  }

  getPlatformType(): 'proxmox' {
    return 'proxmox';
  }

  getSiteInfo(): SiteInfo {
    return {
      id: this.config.id,
      name: this.config.name,
      location: this.config.location,
      url: this.config.url,
      platformType: 'proxmox',
      status: 'online',
    };
  }

  /**
   * Authenticate with Proxmox and get ticket
   */
  async authenticate(): Promise<void> {
    try {
      const authUrl = `${this.config.url}/api2/json/access/ticket`;
      const username = `${this.config.username}@${this.config.realm}`;

      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          username,
          password: this.config.password,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Proxmox authentication failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.data?.ticket) {
        throw new Error('No ticket received from Proxmox');
      }

      this.ticket = {
        ticket: data.data.ticket,
        CSRFPreventionToken: data.data.CSRFPreventionToken,
        expiresAt: Date.now() + (2 * 60 * 60 * 1000), // Tickets valid for 2 hours
      };

      log('Proxmox authentication successful', 'proxmox-client');
    } catch (error) {
      log(`Proxmox authentication failed: ${error}`, 'proxmox-client');
      throw error;
    }
  }

  /**
   * Ensure we have a valid ticket
   */
  private async ensureAuthenticated(): Promise<ProxmoxTicket> {
    if (!this.ticket || Date.now() >= this.ticket.expiresAt) {
      await this.authenticate();
    }
    return this.ticket!;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(endpoint: string, method: string = 'GET', body?: any): Promise<T> {
    const ticket = await this.ensureAuthenticated();
    const url = `${this.config.url}/api2/json${endpoint}`;

    const headers: Record<string, string> = {
      'Cookie': `PVEAuthCookie=${ticket.ticket}`,
      'Accept': 'application/json',
    };

    if (method !== 'GET' && ticket.CSRFPreventionToken) {
      headers['CSRFPreventionToken'] = ticket.CSRFPreventionToken;
    }

    const options: RequestInit = { method, headers };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      options.body = new URLSearchParams(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Proxmox API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return data.data as T;
    } catch (error) {
      log(`Proxmox API request failed: ${error}`, 'proxmox-client');
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
      // Get cluster resources
      const resources = await this.request<any[]>('/cluster/resources');
      
      // Separate nodes, VMs, and storage
      const nodes = resources.filter(r => r.type === 'node');
      const vms = resources.filter(r => r.type === 'qemu' || r.type === 'lxc');
      const storages = resources.filter(r => r.type === 'storage');

      // Aggregate node resources (CPU and memory)
      let cpuCapacity = 0, cpuUsed = 0;
      let memoryCapacity = 0, memoryUsed = 0;

      for (const node of nodes) {
        // CPU: maxcpu is core count, cpu is usage fraction
        cpuCapacity += (node.maxcpu || 0) * 2000; // Assume 2GHz per core -> MHz
        cpuUsed += (node.cpu || 0) * (node.maxcpu || 0) * 2000;
        
        // Memory in bytes
        memoryCapacity += node.maxmem || 0;
        memoryUsed += node.mem || 0;
      }

      // Convert memory to MB
      memoryCapacity = Math.round(memoryCapacity / (1024 * 1024));
      memoryUsed = Math.round(memoryUsed / (1024 * 1024));

      // Aggregate storage
      let storageCapacity = 0, storageUsed = 0;
      for (const storage of storages) {
        storageCapacity += storage.maxdisk || 0;
        storageUsed += storage.disk || 0;
      }
      // Convert to MB
      storageCapacity = Math.round(storageCapacity / (1024 * 1024));
      storageUsed = Math.round(storageUsed / (1024 * 1024));

      // Count VMs
      const totalVms = vms.length;
      const runningVms = vms.filter(vm => vm.status === 'running').length;

      // Proxmox doesn't have traditional IP pools like VCD
      // We can try to get network info from nodes
      let totalIps = 0, usedIps = 0;
      for (const node of nodes) {
        try {
          const network = await this.request<any[]>(`/nodes/${node.node}/network`);
          // Count configured IPs
          for (const iface of network) {
            if (iface.address) totalIps++;
            if (iface.address && iface.active) usedIps++;
          }
        } catch (e) {
          // Skip network enumeration errors
        }
      }

      // Calculate allocated resources from running VMs
      let cpuAllocated = 0, memoryAllocated = 0;
      for (const vm of vms) {
        cpuAllocated += (vm.maxcpu || 0) * 2000;
        memoryAllocated += Math.round((vm.maxmem || 0) / (1024 * 1024));
      }

      return {
        siteId: this.config.id,
        platformType: 'proxmox',
        totalTenants: nodes.length, // Use nodes as "tenants" for Proxmox
        totalVms,
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
          allocatedIps: usedIps,
          usedIps,
          freeIps: totalIps - usedIps,
        },
      };
    } catch (error) {
      log(`Error fetching Proxmox site summary: ${error}`, 'proxmox-client');
      throw error;
    }
  }

  async getTenantAllocations(): Promise<TenantAllocation[]> {
    try {
      // Get cluster resources
      const resources = await this.request<any[]>('/cluster/resources');
      const nodes = resources.filter(r => r.type === 'node');
      const vms = resources.filter(r => r.type === 'qemu' || r.type === 'lxc');
      const storages = resources.filter(r => r.type === 'storage');

      // Group VMs and storage by node
      const allocations: TenantAllocation[] = [];

      for (const node of nodes) {
        const nodeVms = vms.filter(vm => vm.node === node.node);
        const nodeStorages = storages.filter(s => s.node === node.node);

        // Calculate VM resources on this node
        let cpuAllocated = 0, memoryAllocated = 0;
        let runningVmCount = 0;

        for (const vm of nodeVms) {
          cpuAllocated += (vm.maxcpu || 0) * 2000;
          memoryAllocated += Math.round((vm.maxmem || 0) / (1024 * 1024));
          if (vm.status === 'running') runningVmCount++;
        }

        // Node capacity
        const cpuCapacity = (node.maxcpu || 0) * 2000;
        const memoryCapacity = Math.round((node.maxmem || 0) / (1024 * 1024));

        // Storage for this node
        let storageCapacity = 0, storageUsed = 0;
        for (const storage of nodeStorages) {
          storageCapacity += Math.round((storage.maxdisk || 0) / (1024 * 1024));
          storageUsed += Math.round((storage.disk || 0) / (1024 * 1024));
        }

        allocations.push({
          id: node.id || node.node,
          name: node.node,
          status: node.status || 'online',
          cpu: {
            capacity: cpuCapacity,
            allocated: cpuAllocated,
            used: Math.round((node.cpu || 0) * cpuCapacity),
            available: cpuCapacity - cpuAllocated,
            units: 'MHz',
          },
          memory: {
            capacity: memoryCapacity,
            allocated: memoryAllocated,
            used: Math.round((node.mem || 0) / (1024 * 1024)),
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
          vmCount: nodeVms.length,
          runningVmCount,
        });
      }

      return allocations;
    } catch (error) {
      log(`Error fetching Proxmox tenant allocations: ${error}`, 'proxmox-client');
      throw error;
    }
  }

  async getTenantAllocation(tenantId: string): Promise<TenantAllocation | null> {
    try {
      const allocations = await this.getTenantAllocations();
      return allocations.find(a => a.id === tenantId || a.name === tenantId) || null;
    } catch (error) {
      log(`Error fetching Proxmox tenant allocation: ${error}`, 'proxmox-client');
      return null;
    }
  }
}
