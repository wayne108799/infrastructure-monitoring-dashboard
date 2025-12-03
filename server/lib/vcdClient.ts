import { log } from '../index';

// VCD 10.6 API Client

export interface VcdConfig {
  url: string;
  username: string;
  password: string;
  org: string;
  vcpuInMhz?: number; // vCPU speed in MHz (default 2000)
}

export interface VcdSession {
  token: string;
  expiresAt: number;
}

// Response Types from VCD API
interface VcdOrgVdcResponse {
  id: string;
  name: string;
  description?: string;
  href: string;
  isEnabled: boolean;
  allocationModel: string;
  computeCapacity: {
    cpu: {
      units: string;
      allocated: number;
      limit: number;
      reserved: number;
      used: number;
    };
    memory: {
      units: string;
      allocated: number;
      limit: number;
      reserved: number;
      used: number;
    };
  };
  vdcStorageProfiles?: any[];
  status: number;
  vmQuota?: number;
  networkQuota?: number;
  vcpuInMhz?: number;
  isThinProvision?: boolean;
}

interface EdgeGatewayUplink {
  subnets?: {
    values: Array<{
      totalIpCount: number;
      usedIpCount: number;
      gateway: string;
      prefixLength: number;
      ipRanges?: {
        values: Array<{
          startAddress: string;
          endAddress: string;
        }>;
      };
    }>;
  };
}

interface EdgeGatewayResponse {
  id: string;
  name: string;
  edgeGatewayUplinks?: EdgeGatewayUplink[];
}

export class VcdClient {
  private config: VcdConfig;
  private session: VcdSession | null = null;

  constructor(config: VcdConfig) {
    // Trim all config values to remove any whitespace from environment variables
    const username = config.username.trim();
    const password = config.password.trim();
    const org = config.org.trim();
    
    // Ensure URL has protocol
    let url = config.url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    // Remove trailing slash
    url = url.replace(/\/$/, '');
    
    this.config = { ...config, url, username, password, org };
  }

  /**
   * Authenticate with VCD and get session token
   * Tries multiple methods for compatibility with different VCD versions
   */
  async authenticate(): Promise<void> {
    // Determine if using provider login (for System org)
    const isProvider = this.config.org.toLowerCase() === 'system';
    const sessionEndpoint = isProvider ? '/cloudapi/1.0.0/sessions/provider' : '/cloudapi/1.0.0/sessions';

    // For provider login, try username only; for tenant login, use username@org
    const credentialFormats = isProvider 
      ? [
          `${this.config.username}:${this.config.password}`,  // Just username for provider
          `${this.config.username}@${this.config.org}:${this.config.password}`, // username@org format
        ]
      : [
          `${this.config.username}@${this.config.org}:${this.config.password}`,
        ];

    // Try CloudAPI sessions first (VCD 10.4+)
    for (const credentials of credentialFormats) {
      const encodedCredentials = Buffer.from(credentials).toString('base64');
      
      try {
        const cloudApiUrl = `${this.config.url}${sessionEndpoint}`;
        log(`Trying CloudAPI auth at ${cloudApiUrl} with format: ${credentials.split(':')[0]}:***`, 'vcd-client');
        
        const response = await fetch(cloudApiUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json;version=38.0',
            'Content-Type': 'application/json',
            'Authorization': `Basic ${encodedCredentials}`,
          },
        });

        if (response.ok) {
          const token = response.headers.get('x-vmware-vcloud-access-token') || 
                        response.headers.get('x-vcloud-authorization');
          if (token) {
            this.session = {
              token,
              expiresAt: Date.now() + (30 * 60 * 1000),
            };
            log('VCD CloudAPI authentication successful', 'vcd-client');
            return;
          }
        }
        
        // Log more details on failure
        const errorText = await response.text().catch(() => '');
        log(`CloudAPI auth returned ${response.status}: ${errorText}`, 'vcd-client');
      } catch (error) {
        log(`CloudAPI auth attempt failed: ${error}`, 'vcd-client');
      }
    }

    // Try legacy /api/sessions endpoint (for older VCD or different config)
    const legacyCreds = `${this.config.username}@${this.config.org}:${this.config.password}`;
    const encodedLegacy = Buffer.from(legacyCreds).toString('base64');
    
    try {
      const legacyUrl = `${this.config.url}/api/sessions`;
      log(`Trying legacy auth at ${legacyUrl}`, 'vcd-client');
      
      const response = await fetch(legacyUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/*+json;version=38.0',
          'Authorization': `Basic ${encodedLegacy}`,
        },
      });

      if (response.ok) {
        const token = response.headers.get('x-vcloud-authorization');
        if (token) {
          this.session = {
            token,
            expiresAt: Date.now() + (30 * 60 * 1000),
          };
          log('VCD legacy authentication successful', 'vcd-client');
          return;
        }
      }
      
      const errorText = await response.text().catch(() => '');
      throw new Error(`VCD Authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
    } catch (error) {
      log(`VCD authentication error: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Ensure we have a valid session token
   */
  private async ensureAuthenticated(): Promise<string> {
    if (!this.session || Date.now() >= this.session.expiresAt) {
      await this.authenticate();
    }
    return this.session!.token;
  }

  /**
   * Make an authenticated request to VCD API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.ensureAuthenticated();
    const url = `${this.config.url}${endpoint}`;

    // Determine the correct Accept header based on endpoint type
    const isCloudApi = endpoint.startsWith('/cloudapi/');
    const acceptHeader = isCloudApi 
      ? 'application/json;version=38.0'
      : 'application/*+json;version=38.0';

    const response = await fetch(url, {
      ...options,
      headers: {
        'Accept': acceptHeader,
        'Authorization': `Bearer ${token}`,
        'x-vcloud-authorization': token,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`VCD API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Helper to extract just the UUID from a URN format (e.g., "urn:vcloud:vdc:uuid" -> "uuid")
   */
  private extractUuid(id: string): string {
    if (id.startsWith('urn:')) {
      const parts = id.split(':');
      return parts[parts.length - 1];
    }
    return id;
  }

  /**
   * Get all Organization VDCs with compute capacity included
   */
  async getOrgVdcs(): Promise<any[]> {
    try {
      // CloudAPI endpoint for querying VDCs - use query to get computeCapacity details
      const response = await this.request<{ values: VcdOrgVdcResponse[] }>(
        `/cloudapi/1.0.0/vdcs`
      );
      
      return response.values || [];
    } catch (error) {
      log(`Error fetching Org VDCs: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Get VDC details by ID using legacy API (returns full ComputeCapacity)
   */
  async getVdcDetails(vdcId: string): Promise<any> {
    try {
      // Extract UUID from URN for legacy API
      const uuid = this.extractUuid(vdcId);
      
      // Use legacy API which returns full ComputeCapacity data
      const response = await this.request<any>(
        `/api/vdc/${uuid}`
      );
      
      return response;
    } catch (error) {
      log(`Error fetching VDC details for ${vdcId}: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Get VM resources for a VDC (to calculate actual usage)
   */
  async getVdcVmResources(vdcId: string): Promise<{ cpuUsed: number; memoryUsed: number; vmCount: number; runningVmCount: number }> {
    try {
      // Query all VMs in this VDC using the URN format for filter
      const encodedFilter = encodeURIComponent(`vdc==${vdcId}`);
      const response = await this.request<{ record?: any[] }>(
        `/api/query?type=vm&format=records&filter=${encodedFilter}`
      );
      
      const vms = response.record || [];
      let cpuUsed = 0;
      let memoryUsed = 0;
      let runningVmCount = 0;
      
      for (const vm of vms) {
        // Status 4 = POWERED_ON, or check status string
        const isPoweredOn = vm.status === 4 || vm.status === 'POWERED_ON' || vm.isDeployed === true;
        if (isPoweredOn) {
          cpuUsed += (vm.numberOfCpus || 0) * (this.config.vcpuInMhz || 2000);
          memoryUsed += vm.memoryMB || 0;
          runningVmCount++;
        }
      }
      
      return {
        cpuUsed,
        memoryUsed,
        vmCount: vms.length,
        runningVmCount
      };
    } catch (error) {
      log(`Error fetching VM resources for ${vdcId}: ${error}`, 'vcd-client');
      return { cpuUsed: 0, memoryUsed: 0, vmCount: 0, runningVmCount: 0 };
    }
  }

  /**
   * Get storage profiles for a VDC by fetching each profile directly
   */
  async getVdcStorageProfiles(vdcDetails: any): Promise<any[]> {
    try {
      // Use vdcStorageProfiles from VDC details to get profile references
      const profileRefs = vdcDetails.vdcStorageProfiles?.vdcStorageProfile || [];
      
      if (profileRefs.length === 0) {
        log(`No storage profile references found in VDC details`, 'vcd-client');
        return [];
      }

      // Fetch each storage profile to get usage data
      const profiles = await Promise.all(
        profileRefs.map(async (ref: any) => {
          try {
            if (!ref.href) return null;
            
            // Extract the profile ID from href and fetch details
            const profileId = ref.href.split('/').pop();
            const profile = await this.request<any>(`/api/vdcStorageProfile/${profileId}`);
            
            return {
              id: profileId,
              name: profile.name || ref.name || 'Unknown',
              limit: profile.limit || 0,
              used: profile.storageUsedMB || 0,
              units: 'MB',
              default: profile.default || false,
              enabled: profile.enabled !== false
            };
          } catch (e) {
            log(`Error fetching storage profile: ${e}`, 'vcd-client');
            return {
              id: ref.id || ref.name,
              name: ref.name || 'Unknown',
              limit: 0,
              used: 0,
              units: 'MB',
              default: false,
              enabled: true
            };
          }
        })
      );
      
      const validProfiles = profiles.filter(p => p !== null);
      log(`Storage profiles: ${validProfiles.length} found`, 'vcd-client');
      return validProfiles;
    } catch (error) {
      log(`Error fetching storage profiles: ${error}`, 'vcd-client');
      return [];
    }
  }

  /**
   * Get Edge Gateways for a VDC
   */
  async getEdgeGateways(vdcId: string): Promise<EdgeGatewayResponse[]> {
    try {
      const response = await this.request<{ values: EdgeGatewayResponse[] }>(
        `/cloudapi/1.0.0/edgeGateways?filter=ownerRef.id==${vdcId}`
      );
      
      return response.values || [];
    } catch (error) {
      log(`Error fetching edge gateways for ${vdcId}: ${error}`, 'vcd-client');
      return [];
    }
  }

  /**
   * Get IP allocation data from Edge Gateway
   */
  async getIpAllocations(edgeGatewayId: string): Promise<{
    totalIpCount: number;
    usedIpCount: number;
    freeIpCount: number;
    subnets: any[];
  }> {
    try {
      const gateway = await this.request<EdgeGatewayResponse>(
        `/cloudapi/1.0.0/edgeGateways/${edgeGatewayId}`
      );

      let totalIpCount = 0;
      let usedIpCount = 0;
      const subnets: any[] = [];

      if (gateway.edgeGatewayUplinks) {
        for (const uplink of gateway.edgeGatewayUplinks) {
          if (uplink.subnets?.values) {
            for (const subnet of uplink.subnets.values) {
              totalIpCount += subnet.totalIpCount || 0;
              usedIpCount += subnet.usedIpCount || 0;
              
              subnets.push({
                gateway: subnet.gateway,
                netmask: this.prefixToNetmask(subnet.prefixLength),
                primaryIp: subnet.gateway,
                ipRanges: subnet.ipRanges?.values || []
              });
            }
          }
        }
      }

      return {
        totalIpCount,
        usedIpCount,
        freeIpCount: totalIpCount - usedIpCount,
        subnets
      };
    } catch (error) {
      log(`Error fetching IP allocations for ${edgeGatewayId}: ${error}`, 'vcd-client');
      return { totalIpCount: 0, usedIpCount: 0, freeIpCount: 0, subnets: [] as any[] };
    }
  }

  /**
   * Helper to convert CIDR prefix to netmask
   */
  private prefixToNetmask(prefix: number): string {
    const mask = ~((1 << (32 - prefix)) - 1);
    return [
      (mask >>> 24) & 0xff,
      (mask >>> 16) & 0xff,
      (mask >>> 8) & 0xff,
      mask & 0xff
    ].join('.');
  }

  /**
   * Get comprehensive VDC data (all resources)
   */
  async getVdcComprehensive(vdcId: string): Promise<any> {
    try {
      // First get VDC details, then use it to fetch related data
      const [details, edgeGateways, vmResources] = await Promise.all([
        this.getVdcDetails(vdcId),
        this.getEdgeGateways(vdcId),
        this.getVdcVmResources(vdcId)
      ]);

      // Fetch storage profiles using the VDC details
      const storageProfiles = await this.getVdcStorageProfiles(details);

      // Get IP allocations from first edge gateway
      let ipAllocations: { totalIpCount: number; usedIpCount: number; freeIpCount: number; subnets: any[] } = { totalIpCount: 0, usedIpCount: 0, freeIpCount: 0, subnets: [] };
      if (edgeGateways.length > 0) {
        ipAllocations = await this.getIpAllocations(edgeGateways[0].id);
      }

      return {
        ...details,
        storageProfiles,
        vmResources,
        network: {
          allocatedIps: ipAllocations
        }
      };
    } catch (error) {
      log(`Error fetching comprehensive VDC data for ${vdcId}: ${error}`, 'vcd-client');
      throw error;
    }
  }
}
