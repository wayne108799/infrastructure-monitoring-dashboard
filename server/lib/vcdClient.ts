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
  org?: {
    id: string;
    name: string;
  };
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
   * Get organization details by ID (accepts URN or UUID format)
   */
  async getOrgDetails(orgId: string): Promise<{ id: string; name: string; fullName: string } | null> {
    try {
      // CloudAPI expects the full URN, URL-encoded
      // If orgId is already a URN (urn:vcloud:org:uuid), use it directly (URL-encoded)
      // If it's just a UUID, construct the URN
      let orgUrn = orgId;
      if (!orgId.startsWith('urn:')) {
        orgUrn = `urn:vcloud:org:${orgId}`;
      }
      
      const encodedUrn = encodeURIComponent(orgUrn);
      const response = await this.request<any>(`/cloudapi/1.0.0/orgs/${encodedUrn}`);
      return {
        id: response.id,
        name: response.name,
        fullName: response.displayName || response.fullName || response.name,
      };
    } catch (error) {
      log(`Error fetching org details for ${orgId}: ${error}`, 'vcd-client');
      return null;
    }
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
      
      const vdcs = response.values || [];
      
      // Log first VDC to see structure
      if (vdcs.length > 0) {
        log(`First VDC raw data keys: ${Object.keys(vdcs[0]).join(', ')}`, 'vcd-client');
        if (vdcs[0].org) {
          log(`First VDC org: ${JSON.stringify(vdcs[0].org)}`, 'vcd-client');
        } else {
          log(`First VDC has no 'org' field. Looking for orgRef or similar...`, 'vcd-client');
          // Check for alternative org reference fields
          const orgRefFields = ['orgRef', 'orgId', 'organization', 'owner', 'ownerRef'];
          for (const field of orgRefFields) {
            if ((vdcs[0] as any)[field]) {
              log(`Found org in field '${field}': ${JSON.stringify((vdcs[0] as any)[field])}`, 'vcd-client');
            }
          }
        }
      }
      
      // Fetch org details to get fullName for each unique org
      const orgCache = new Map<string, { id: string; name: string; fullName: string }>();
      
      for (const vdc of vdcs) {
        // Try multiple possible org reference locations
        const orgId = vdc.org?.id || (vdc as any).orgRef?.id || (vdc as any).owner?.id;
        if (orgId && !orgCache.has(orgId)) {
          log(`Fetching org details for: ${orgId}`, 'vcd-client');
          const orgDetails = await this.getOrgDetails(orgId);
          if (orgDetails) {
            log(`Got org details: name=${orgDetails.name}, fullName=${orgDetails.fullName}`, 'vcd-client');
            orgCache.set(orgId, orgDetails);
          }
        }
      }
      
      // Enrich VDCs with org fullName
      return vdcs.map(vdc => {
        const orgId = vdc.org?.id || (vdc as any).orgRef?.id || (vdc as any).owner?.id;
        const orgDetails = orgId ? orgCache.get(orgId) : undefined;
        return {
          ...vdc,
          orgName: orgDetails?.name || vdc.org?.name,
          orgFullName: orgDetails?.fullName || vdc.org?.name,
        };
      });
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
   * Uses multiple approaches to find VMs reliably
   */
  async getVdcVmResources(vdcId: string): Promise<{ cpuUsed: number; memoryUsed: number; vmCount: number; runningVmCount: number }> {
    try {
      const uuid = this.extractUuid(vdcId);
      
      // Try adminVM query which is more reliable for provider context
      try {
        const encodedFilter = encodeURIComponent(`vdc==${uuid}`);
        const response = await this.request<{ record?: any[] }>(
          `/api/query?type=adminVM&format=records&filter=${encodedFilter}&fields=name,status,numberOfCpus,memoryMB,vdc,isVAppTemplate`
        );
        
        // Filter out vApp templates - only count actual VMs
        const allRecords = response.record || [];
        const vms = allRecords.filter((vm: any) => vm.isVAppTemplate !== true && vm.isVAppTemplate !== 'true');
        
        let cpuUsed = 0;
        let memoryUsed = 0;
        let runningVmCount = 0;
        
        for (const vm of vms) {
          // Status 4 = POWERED_ON
          const isPoweredOn = vm.status === 4 || vm.status === 'POWERED_ON';
          if (isPoweredOn) {
            cpuUsed += (vm.numberOfCpus || 0) * (this.config.vcpuInMhz || 2000);
            memoryUsed += vm.memoryMB || 0;
            runningVmCount++;
          }
        }
        
        if (vms.length > 0) {
          log(`VDC ${uuid}: Found ${vms.length} VMs (adminVM query), ${runningVmCount} running`, 'vcd-client');
        }
        
        return {
          cpuUsed,
          memoryUsed,
          vmCount: vms.length,
          runningVmCount
        };
      } catch (adminError) {
        log(`adminVM query failed for ${uuid}: ${adminError}`, 'vcd-client');
      }

      // Fallback: Try CloudAPI with orgVdc filter
      try {
        const cloudApiFilter = encodeURIComponent(`orgVdc.id==${vdcId}`);
        const cloudApiResponse = await this.request<{ values?: any[], resultTotal?: number }>(
          `/cloudapi/1.0.0/vms?filter=${cloudApiFilter}&pageSize=100`
        );
        
        const vms = (cloudApiResponse.values || []).filter((vm: any) => !vm.isVAppTemplate);
        let cpuUsed = 0;
        let memoryUsed = 0;
        let runningVmCount = 0;
        
        for (const vm of vms) {
          const isPoweredOn = vm.status === 'POWERED_ON';
          if (isPoweredOn) {
            cpuUsed += (vm.numberOfCpus || 0) * (this.config.vcpuInMhz || 2000);
            memoryUsed += vm.memoryMB || vm.memorySizeMB || 0;
            runningVmCount++;
          }
        }
        
        if (vms.length > 0) {
          log(`VDC ${uuid}: Found ${vms.length} VMs (CloudAPI), ${runningVmCount} running`, 'vcd-client');
        }
        
        return {
          cpuUsed,
          memoryUsed,
          vmCount: vms.length,
          runningVmCount
        };
      } catch (cloudApiError) {
        log(`CloudAPI VM query failed for ${uuid}: ${cloudApiError}`, 'vcd-client');
      }
      
      // Final fallback: standard vm query
      try {
        const encodedFilter = encodeURIComponent(`vdc==${uuid}`);
        const response = await this.request<{ record?: any[] }>(
          `/api/query?type=vm&format=records&filter=${encodedFilter}`
        );
        
        const vms = (response.record || []).filter((vm: any) => vm.isVAppTemplate !== true);
        let cpuUsed = 0;
        let memoryUsed = 0;
        let runningVmCount = 0;
        
        for (const vm of vms) {
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
      } catch (legacyError) {
        log(`Legacy VM query failed for ${uuid}: ${legacyError}`, 'vcd-client');
      }
      
      return { cpuUsed: 0, memoryUsed: 0, vmCount: 0, runningVmCount: 0 };
    } catch (error) {
      log(`Error fetching VM resources for ${vdcId}: ${error}`, 'vcd-client');
      return { cpuUsed: 0, memoryUsed: 0, vmCount: 0, runningVmCount: 0 };
    }
  }

  /**
   * Get VM names for a VDC (for backup matching)
   */
  async getVmsForVdc(vdcId: string): Promise<Array<{ name: string; id: string }>> {
    try {
      const uuid = this.extractUuid(vdcId);
      
      // Try adminVM query first
      try {
        const encodedFilter = encodeURIComponent(`vdc==${uuid}`);
        const response = await this.request<{ record?: any[] }>(
          `/api/query?type=adminVM&format=records&filter=${encodedFilter}&fields=name,href,isVAppTemplate`
        );
        
        const vms = (response.record || []).filter((vm: any) => 
          vm.isVAppTemplate !== true && vm.isVAppTemplate !== 'true'
        );
        
        return vms.map((vm: any) => ({
          name: vm.name || '',
          id: vm.href || ''
        }));
      } catch {
        // Fallback to CloudAPI
        const cloudApiFilter = encodeURIComponent(`orgVdc.id==${vdcId}`);
        const cloudApiResponse = await this.request<{ values?: any[] }>(
          `/cloudapi/1.0.0/vms?filter=${cloudApiFilter}&pageSize=1000`
        );
        
        const vms = (cloudApiResponse.values || []).filter((vm: any) => !vm.isVAppTemplate);
        return vms.map((vm: any) => ({
          name: vm.name || '',
          id: vm.id || ''
        }));
      }
    } catch (error) {
      log(`Error fetching VMs for VDC ${vdcId}: ${error}`, 'vcd-client');
      return [];
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
   * Get all Edge Gateways (for total IP summary)
   */
  async getAllEdgeGateways(): Promise<EdgeGatewayResponse[]> {
    try {
      const response = await this.request<{ values: EdgeGatewayResponse[] }>(
        `/cloudapi/1.0.0/edgeGateways?pageSize=100`
      );
      
      return response.values || [];
    } catch (error) {
      log(`Error fetching all edge gateways: ${error}`, 'vcd-client');
      return [];
    }
  }

  /**
   * Get External Networks (Provider networks with IP pools)
   */
  async getExternalNetworks(): Promise<any[]> {
    try {
      const response = await this.request<{ values: any[] }>(
        `/cloudapi/1.0.0/externalNetworks?pageSize=100`
      );
      
      return response.values || [];
    } catch (error) {
      log(`Error fetching external networks: ${error}`, 'vcd-client');
      return [];
    }
  }

  /**
   * Get IP allocation data from Edge Gateway with detailed used IP query
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

      // If usedIpCount is 0, try to get allocated IPs from the gateway's used IP endpoint
      if (usedIpCount === 0) {
        try {
          const usedIpsResponse = await this.request<{ values?: any[], resultTotal?: number }>(
            `/cloudapi/1.0.0/edgeGateways/${edgeGatewayId}/usedIpAddresses?pageSize=100`
          );
          usedIpCount = usedIpsResponse.resultTotal || (usedIpsResponse.values?.length || 0);
        } catch (e) {
          // Ignore - usedIpAddresses endpoint might not be available
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
   * Get site-wide IP summary from external networks
   * Returns total available IPs, allocated (assigned to edge gateways), and used
   */
  async getSiteIpSummary(): Promise<{
    totalIps: number;
    allocatedIps: number;
    usedIps: number;
    freeIps: number;
  }> {
    try {
      let totalIps = 0;
      let allocatedIps = 0;
      let usedIps = 0;

      // Get external networks to find total IP pool
      const externalNetworks = await this.getExternalNetworks();
      
      for (const extNet of externalNetworks) {
        // Each external network has subnets with IP ranges
        if (extNet.subnets?.values) {
          for (const subnet of extNet.subnets.values) {
            totalIps += subnet.totalIpCount || 0;
            usedIps += subnet.usedIpCount || 0;
          }
        }
      }

      // Also query all edge gateways to get allocated IPs
      const allGateways = await this.getAllEdgeGateways();
      
      for (const gw of allGateways) {
        try {
          // Get IP allocations per gateway
          const ipData = await this.getIpAllocations(gw.id);
          allocatedIps += ipData.totalIpCount;
          // usedIps is already counted from external networks
        } catch (e) {
          // Skip failed gateway queries
        }
      }

      // If external network query didn't return IPs, use allocated as total
      if (totalIps === 0) {
        totalIps = allocatedIps;
      }

      log(`Site IP Summary: Total=${totalIps}, Allocated=${allocatedIps}, Used=${usedIps}`, 'vcd-client');

      return {
        totalIps,
        allocatedIps,
        usedIps,
        freeIps: totalIps - usedIps
      };
    } catch (error) {
      log(`Error fetching site IP summary: ${error}`, 'vcd-client');
      return { totalIps: 0, allocatedIps: 0, usedIps: 0, freeIps: 0 };
    }
  }

  /**
   * Get Provider VDC Storage Profile details with capacity from vCenter
   */
  async getProviderStorageProfileDetails(href: string): Promise<{ capacity: number; used: number; name: string } | null> {
    try {
      const id = href?.split('/').pop();
      if (!id) return null;
      
      // Fetch the storage profile details directly
      const profile = await this.request<any>(`/api/admin/pvdcStorageProfile/${id}`);
      
      // Log all available fields to find the correct capacity field
      log(`Provider Storage Profile "${profile.name}" raw fields: storageTotalMB=${profile.storageTotalMB}, storageUsedMB=${profile.storageUsedMB}, capacityTotal=${profile.capacityTotal}, capacityUsed=${profile.capacityUsed}, limit=${profile.limit}, units=${profile.units}, providerVdcStorageCapacityMB=${profile.providerVdcStorageCapacityMB}`, 'vcd-client');
      
      // VCD 10.6 may report storage in different fields depending on configuration
      // Try multiple potential capacity sources in order of preference:
      // 1. storageTotalMB - actual backing storage capacity in MB
      // 2. providerVdcStorageCapacityMB - provider capacity
      // 3. capacityTotal - may be in KB, need to convert
      let capacityMB = 0;
      let usedMB = 0;
      
      if (profile.storageTotalMB && profile.storageTotalMB > 0) {
        // Already in MB - this is the vCenter backing storage
        capacityMB = profile.storageTotalMB;
      } else if (profile.providerVdcStorageCapacityMB && profile.providerVdcStorageCapacityMB > 0) {
        capacityMB = profile.providerVdcStorageCapacityMB;
      } else if (profile.capacityTotal) {
        // capacityTotal is in KB, convert to MB
        capacityMB = Math.round(profile.capacityTotal / 1024);
      }
      
      if (profile.storageUsedMB && profile.storageUsedMB > 0) {
        usedMB = profile.storageUsedMB;
      } else if (profile.capacityUsed) {
        // capacityUsed might be in KB, convert to MB
        usedMB = Math.round(profile.capacityUsed / 1024);
      } else if (profile.storageUsed) {
        usedMB = Math.round(profile.storageUsed / 1024);
      }
      
      log(`Provider Storage Profile "${profile.name}": resolved capacity=${capacityMB}MB, used=${usedMB}MB`, 'vcd-client');
      
      return {
        name: profile.name || 'Unknown',
        capacity: capacityMB,
        used: usedMB
      };
    } catch (e) {
      log(`Error fetching provider storage profile details: ${e}`, 'vcd-client');
      return null;
    }
  }

  /**
   * Get vCenter Servers registered with VCD
   */
  async getVimServers(): Promise<any[]> {
    try {
      const response = await this.request<any>(`/api/admin/extension/vimServerReferences`);
      return response.vimServerReference || [];
    } catch (e) {
      log(`Error fetching vCenter servers: ${e}`, 'vcd-client');
      return [];
    }
  }

  /**
   * Get actual vCenter storage profile capacity (datastore capacity from vCenter)
   * This returns TotalStorageMb and FreeStorageMb - the actual physical capacity
   */
  async getVcenterStorageCapacity(): Promise<Record<string, { totalMb: number; freeMb: number; usedMb: number }>> {
    try {
      const vimServers = await this.getVimServers();
      log(`Found ${vimServers.length} vCenter Server(s)`, 'vcd-client');
      
      const storageMap: Record<string, { totalMb: number; freeMb: number; usedMb: number }> = {};
      
      for (const vim of vimServers) {
        const vimId = vim.href?.split('/').pop();
        if (!vimId) continue;
        
        try {
          // Get storage profiles from this vCenter - this returns actual datastore capacity
          const response = await this.request<any>(`/api/admin/extension/vimServer/${vimId}/storageProfiles`);
          
          // VCD API may return profiles in different formats - check for vmwStorageProfile (lowercase)
          const profiles = response.vmwStorageProfile || response.vMWStorageProfile || 
                          response.VMWStorageProfile || response.storageProfile || response.record || [];
          
          for (const profile of profiles) {
            const name = profile.name || profile.Name || 'Unknown';
            // VCD vimServer API returns storage in KB despite field names suggesting MB
            // We need to divide by 1024 to convert to actual MB
            const rawTotal = profile.totalStorageMB || profile.TotalStorageMb || 
                           profile.totalStorageMb || 0;
            const rawFree = profile.freeStorageMB || profile.FreeStorageMb || 
                          profile.freeStorageMb || 0;
            
            // These values are actually in KB, convert to MB
            const totalMb = Math.round(rawTotal / 1024);
            const freeMb = Math.round(rawFree / 1024);
            const usedMb = totalMb - freeMb;
            
            // Aggregate by profile name (in case same profile exists on multiple vCenters)
            if (!storageMap[name]) {
              storageMap[name] = { totalMb: 0, freeMb: 0, usedMb: 0 };
            }
            storageMap[name].totalMb += totalMb;
            storageMap[name].freeMb += freeMb;
            storageMap[name].usedMb += usedMb;
          }
        } catch (profileError) {
          log(`Error fetching storage profiles for vCenter ${vim.name}: ${profileError}`, 'vcd-client');
        }
      }
      
      return storageMap;
    } catch (e) {
      log(`Error fetching vCenter storage capacity: ${e}`, 'vcd-client');
      return {};
    }
  }

  /**
   * Get Provider VDCs (resource pool capacity) - requires provider admin access
   */
  async getProviderVdcs(): Promise<any[]> {
    try {
      // Query Provider VDCs via admin extension API
      const response = await this.request<any>(
        `/api/admin/extension/providerVdcReferences`
      );
      
      const refs = response.providerVdcReference || [];
      
      // Fetch details for each PVDC
      const pvdcs = await Promise.all(
        refs.map(async (ref: any) => {
          try {
            const id = ref.href?.split('/').pop();
            if (!id) return null;
            
            const details = await this.request<any>(`/api/admin/extension/providervdc/${id}`);
            return details;
          } catch (e) {
            log(`Error fetching PVDC details: ${e}`, 'vcd-client');
            return null;
          }
        })
      );
      
      return pvdcs.filter(p => p !== null);
    } catch (error) {
      log(`Error fetching Provider VDCs: ${error}`, 'vcd-client');
      return [];
    }
  }

  /**
   * Get Provider VDC capacity summary (total resource pool availability)
   * Also fetches actual vCenter datastore capacity when available
   */
  async getProviderCapacity(): Promise<{
    cpu: { capacity: number; allocated: number; reserved: number; used: number; available: number; units: string };
    memory: { capacity: number; allocated: number; reserved: number; used: number; available: number; units: string };
    storage: { capacity: number; allocated: number; used: number; available: number; units: string };
    storageTiers: Array<{ name: string; capacity: number; used: number }>;
  }> {
    try {
      // Fetch Provider VDCs and vCenter storage capacity in parallel
      const [pvdcs, vcenterStorage] = await Promise.all([
        this.getProviderVdcs(),
        this.getVcenterStorageCapacity()
      ]);
      
      log(`Found ${pvdcs.length} Provider VDC(s)`, 'vcd-client');
      log(`vCenter storage profiles found: ${Object.keys(vcenterStorage).join(', ') || 'none'}`, 'vcd-client');
      
      let cpuCapacity = 0, cpuAllocated = 0, cpuReserved = 0, cpuUsed = 0;
      let memoryCapacity = 0, memoryAllocated = 0, memoryReserved = 0, memoryUsed = 0;
      let storageCapacity = 0, storageAllocated = 0, storageUsed = 0;
      const storageTierMap: Record<string, { capacity: number; used: number }> = {};
      
      for (const pvdc of pvdcs) {
        log(`Processing Provider VDC: ${pvdc.name}`, 'vcd-client');
        // CPU capacity from computeCapacity
        if (pvdc.computeCapacity?.cpu) {
          const cpu = pvdc.computeCapacity.cpu;
          cpuCapacity += cpu.total || cpu.limit || 0;
          cpuAllocated += cpu.allocation || cpu.allocated || 0;
          cpuReserved += cpu.reserved || 0;
          cpuUsed += cpu.used || 0;
        }
        
        // Memory capacity
        if (pvdc.computeCapacity?.memory) {
          const mem = pvdc.computeCapacity.memory;
          memoryCapacity += mem.total || mem.limit || 0;
          memoryAllocated += mem.allocation || mem.allocated || 0;
          memoryReserved += mem.reserved || 0;
          memoryUsed += mem.used || 0;
        }
        
        // Storage from storageProfiles - need to fetch each profile details for capacity
        if (pvdc.storageProfiles?.providerVdcStorageProfile) {
          const profileDetails = await Promise.all(
            pvdc.storageProfiles.providerVdcStorageProfile.map(async (sp: any) => {
              if (sp.href) {
                const details = await this.getProviderStorageProfileDetails(sp.href);
                return details || { name: sp.name, capacity: 0, used: 0 };
              }
              return { 
                name: sp.name, 
                capacity: sp.capacityTotal || sp.storageTotalMB || 0, 
                used: sp.storageUsedMB || 0 
              };
            })
          );
          
          for (const profile of profileDetails) {
            const tierName = profile.name;
            
            // Check if we have actual vCenter capacity for this profile
            // Try exact match first, then case-insensitive match
            let vcCapacity = vcenterStorage[tierName];
            if (!vcCapacity) {
              // Try to find matching profile by name (case-insensitive, partial match)
              const matchingKey = Object.keys(vcenterStorage).find(k => 
                k.toLowerCase() === tierName.toLowerCase() ||
                k.toLowerCase().includes(tierName.toLowerCase()) ||
                tierName.toLowerCase().includes(k.toLowerCase())
              );
              if (matchingKey) {
                vcCapacity = vcenterStorage[matchingKey];
                log(`Matched Provider profile "${tierName}" to vCenter profile "${matchingKey}"`, 'vcd-client');
              }
            }
            
            // Use vCenter capacity if available, otherwise fall back to Provider VDC capacity
            const actualCapacity = vcCapacity?.totalMb || profile.capacity;
            const actualUsed = vcCapacity?.usedMb || profile.used;
            
            storageCapacity += actualCapacity;
            storageUsed += actualUsed;
            
            // Aggregate by tier name
            if (!storageTierMap[tierName]) {
              storageTierMap[tierName] = { capacity: 0, used: 0 };
            }
            storageTierMap[tierName].capacity += actualCapacity;
            storageTierMap[tierName].used += actualUsed;
            
            if (vcCapacity) {
              log(`Provider VDC Storage Profile "${tierName}": vCenter capacity=${actualCapacity}MB, used=${actualUsed}MB (from vimServer API)`, 'vcd-client');
            } else {
              log(`Provider VDC Storage Profile "${tierName}": capacity=${actualCapacity}MB, used=${actualUsed}MB (from Provider VDC)`, 'vcd-client');
            }
          }
        }
      }
      
      // Convert storage tier map to array
      const storageTiers = Object.entries(storageTierMap).map(([name, data]) => ({
        name,
        capacity: data.capacity,
        used: data.used
      }));
      
      log(`Provider VDC Total Storage: capacity=${storageCapacity}MB, used=${storageUsed}MB`, 'vcd-client');
      log(`Storage tiers aggregated: ${storageTiers.map(t => `${t.name}=${t.capacity}MB`).join(', ')}`, 'vcd-client');
      
      return {
        cpu: {
          capacity: cpuCapacity,
          allocated: cpuAllocated,
          reserved: cpuReserved,
          used: cpuUsed,
          available: cpuCapacity - cpuAllocated,
          units: 'MHz'
        },
        memory: {
          capacity: memoryCapacity,
          allocated: memoryAllocated,
          reserved: memoryReserved,
          used: memoryUsed,
          available: memoryCapacity - memoryAllocated,
          units: 'MB'
        },
        storage: {
          capacity: storageCapacity,
          allocated: storageAllocated,
          used: storageUsed,
          available: storageCapacity - storageAllocated,
          units: 'MB'
        },
        storageTiers
      };
    } catch (error) {
      log(`Error fetching provider capacity: ${error}`, 'vcd-client');
      // Return empty if we can't access provider VDCs
      return {
        cpu: { capacity: 0, allocated: 0, reserved: 0, used: 0, available: 0, units: 'MHz' },
        memory: { capacity: 0, allocated: 0, reserved: 0, used: 0, available: 0, units: 'MB' },
        storage: { capacity: 0, allocated: 0, used: 0, available: 0, units: 'MB' },
        storageTiers: []
      };
    }
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

  /**
   * Get provisioning resources (Provider VDCs, storage profiles, external networks, network pools)
   */
  async getProvisioningResources(): Promise<{
    providerVdcs: any[];
    storageProfiles: any[];
    externalNetworks: any[];
    networkPools: any[];
  }> {
    try {
      const [providerVdcs, externalNetworks] = await Promise.all([
        this.getProviderVdcs(),
        this.getExternalNetworks(),
      ]);

      const storageProfiles: any[] = [];
      const networkPools: any[] = [];

      for (const pvdc of providerVdcs) {
        if (pvdc.storageProfiles) {
          for (const sp of pvdc.storageProfiles) {
            storageProfiles.push({
              id: sp.id || sp.href?.split('/').pop(),
              name: sp.name,
              providerVdc: pvdc.name,
            });
          }
        }
        if (pvdc.networkPools) {
          for (const np of pvdc.networkPools) {
            networkPools.push({
              id: np.id || np.href?.split('/').pop(),
              name: np.name,
              providerVdc: pvdc.name,
            });
          }
        }
      }

      return {
        providerVdcs,
        storageProfiles,
        externalNetworks,
        networkPools,
      };
    } catch (error) {
      log(`Error fetching provisioning resources: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Wait for a VCD task to complete
   */
  async waitForTask(taskHref: string, timeoutMs: number = 300000): Promise<any> {
    const startTime = Date.now();
    const pollInterval = 2000;
    
    let taskUrl = taskHref;
    if (taskHref.startsWith('http')) {
      const url = new URL(taskHref);
      taskUrl = url.pathname;
    } else if (!taskHref.startsWith('/')) {
      taskUrl = `/api/task/${taskHref}`;
    }
    
    log(`Polling task: ${taskUrl}`, 'vcd-client');
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const task = await this.request<any>(taskUrl);
        
        const status = task.status?.toLowerCase() || '';
        log(`Task status: ${status}`, 'vcd-client');
        
        if (status === 'success') {
          return task;
        }
        
        if (status === 'error' || status === 'aborted' || status === 'canceled') {
          const errorMsg = task.details || task.error?.message || task.message || 'Task failed';
          throw new Error(`Task failed: ${errorMsg}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error: any) {
        if (error.message?.includes('Task failed')) {
          throw error;
        }
        log(`Error polling task: ${error}`, 'vcd-client');
      }
    }
    
    throw new Error('Task timeout exceeded');
  }

  /**
   * Create a new Organization
   */
  async createOrganization(params: {
    name: string;
    displayName: string;
    description?: string;
  }): Promise<{ id: string; name: string }> {
    try {
      log(`Creating organization: ${params.name}`, 'vcd-client');
      
      const token = await this.ensureAuthenticated();
      const url = `${this.config.url}/cloudapi/1.0.0/orgs`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;version=38.0',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: params.name,
          displayName: params.displayName,
          description: params.description || '',
          isEnabled: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create organization: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      
      if (response.headers.get('location')) {
        const taskUrl = response.headers.get('location');
        if (taskUrl) {
          await this.waitForTask(taskUrl);
        }
      }

      log(`Organization created: ${result.id}`, 'vcd-client');
      return { id: result.id, name: result.name };
    } catch (error) {
      log(`Error creating organization: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Create an Org VDC using legacy API (CloudAPI doesn't support VDC creation directly)
   */
  async createOrgVdc(params: {
    orgId: string;
    name: string;
    description?: string;
    allocationModel: string;
    providerVdcId: string;
    networkPoolId?: string;
    cpuAllocatedMHz: number;
    cpuLimitMHz: number;
    memoryAllocatedMB: number;
    memoryLimitMB: number;
    storageProfileId: string;
    storageLimitMB: number;
    networkQuota: number;
  }): Promise<{ id: string; name: string }> {
    try {
      log(`Creating Org VDC: ${params.name} for org ${params.orgId}`, 'vcd-client');
      
      const orgUuid = this.extractUuid(params.orgId);
      const pvdcUuid = this.extractUuid(params.providerVdcId);
      const storageProfileUuid = this.extractUuid(params.storageProfileId);
      
      const token = await this.ensureAuthenticated();
      const url = `${this.config.url}/api/admin/org/${orgUuid}/vdcsparams`;
      
      const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<CreateVdcParams name="${params.name}" xmlns="http://www.vmware.com/vcloud/v1.5">
    <Description>${params.description || ''}</Description>
    <AllocationModel>${params.allocationModel}</AllocationModel>
    <ComputeCapacity>
        <Cpu>
            <Units>MHz</Units>
            <Allocated>${params.cpuAllocatedMHz}</Allocated>
            <Limit>${params.cpuLimitMHz}</Limit>
        </Cpu>
        <Memory>
            <Units>MB</Units>
            <Allocated>${params.memoryAllocatedMB}</Allocated>
            <Limit>${params.memoryLimitMB}</Limit>
        </Memory>
    </ComputeCapacity>
    <NicQuota>0</NicQuota>
    <NetworkQuota>${params.networkQuota}</NetworkQuota>
    <VdcStorageProfile>
        <Enabled>true</Enabled>
        <Units>MB</Units>
        <Limit>${params.storageLimitMB}</Limit>
        <Default>true</Default>
        <ProviderVdcStorageProfile href="${this.config.url}/api/admin/pvdcStorageProfile/${storageProfileUuid}" />
    </VdcStorageProfile>
    <ResourceGuaranteedMemory>1</ResourceGuaranteedMemory>
    <ResourceGuaranteedCpu>1</ResourceGuaranteedCpu>
    <VCpuInMhz>2800</VCpuInMhz>
    <IsThinProvision>true</IsThinProvision>
    ${params.networkPoolId ? `<NetworkPoolReference href="${this.config.url}/api/admin/extension/networkPool/${this.extractUuid(params.networkPoolId)}"/>` : ''}
    <ProviderVdcReference href="${this.config.url}/api/admin/providervdc/${pvdcUuid}"/>
    <UsesFastProvisioning>false</UsesFastProvisioning>
</CreateVdcParams>`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/*+xml;version=38.0',
          'Content-Type': 'application/vnd.vmware.admin.createVdcParams+xml',
          'Authorization': `Bearer ${token}`,
          'x-vcloud-authorization': token,
        },
        body: xmlBody,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create Org VDC: ${response.status} ${errorText}`);
      }

      const responseText = await response.text();
      
      const hrefMatch = responseText.match(/href="[^"]*\/vdc\/([^"]+)"/);
      const vdcId = hrefMatch ? hrefMatch[1] : '';
      
      const nameMatch = responseText.match(/name="([^"]+)"/);
      const vdcName = nameMatch ? nameMatch[1] : params.name;

      if (response.headers.get('location')) {
        const taskUrl = response.headers.get('location');
        if (taskUrl) {
          await this.waitForTask(taskUrl);
        }
      }

      log(`Org VDC created: ${vdcId}`, 'vcd-client');
      return { id: `urn:vcloud:vdc:${vdcId}`, name: vdcName };
    } catch (error) {
      log(`Error creating Org VDC: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Create an Edge Gateway
   */
  async createEdgeGateway(params: {
    name: string;
    description?: string;
    orgVdcId: string;
    orgId: string;
    externalNetworkId: string;
    primaryIpAddress?: string;
  }): Promise<{ id: string; name: string; primaryIp?: string }> {
    try {
      log(`Creating Edge Gateway: ${params.name}`, 'vcd-client');
      
      const extNet = await this.request<any>(`/cloudapi/1.0.0/externalNetworks/${params.externalNetworkId}`);
      
      let primaryIp = params.primaryIpAddress;
      let gateway = '';
      let prefixLength = 24;
      
      if (extNet.subnets?.values?.length > 0) {
        const subnet = extNet.subnets.values[0];
        gateway = subnet.gateway;
        prefixLength = subnet.prefixLength;
        
        if (!primaryIp && subnet.ipRanges?.values?.length > 0) {
          primaryIp = subnet.ipRanges.values[0].startAddress;
        }
      }

      const token = await this.ensureAuthenticated();
      const url = `${this.config.url}/cloudapi/1.0.0/edgeGateways`;
      
      const body = {
        name: params.name,
        description: params.description || '',
        edgeGatewayUplinks: [{
          uplinkId: params.externalNetworkId,
          subnets: {
            values: [{
              gateway,
              prefixLength,
              ipRanges: primaryIp ? {
                values: [{ startAddress: primaryIp, endAddress: primaryIp }]
              } : undefined,
              enabled: true,
              primaryIp: primaryIp,
            }]
          },
          connected: true,
          dedicated: false,
        }],
        ownerRef: { id: params.orgVdcId },
        orgRef: { id: params.orgId },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;version=38.0',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create Edge Gateway: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      
      if (response.headers.get('location')) {
        const taskUrl = response.headers.get('location');
        if (taskUrl) {
          await this.waitForTask(taskUrl);
        }
      }

      log(`Edge Gateway created: ${result.id}`, 'vcd-client');
      return { id: result.id, name: result.name, primaryIp };
    } catch (error) {
      log(`Error creating Edge Gateway: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Create an SNAT rule on an Edge Gateway
   */
  async createSnatRule(params: {
    edgeGatewayId: string;
    name: string;
    externalAddress: string;
    internalAddresses: string;
  }): Promise<{ id: string }> {
    try {
      log(`Creating SNAT rule on ${params.edgeGatewayId}`, 'vcd-client');
      
      const token = await this.ensureAuthenticated();
      const url = `${this.config.url}/cloudapi/1.0.0/edgeGateways/${params.edgeGatewayId}/nat/rules`;
      
      const body = {
        name: params.name,
        description: 'Auto-provisioned outbound SNAT rule',
        enabled: true,
        ruleType: 'SNAT',
        externalAddresses: params.externalAddress,
        internalAddresses: params.internalAddresses,
        firewallMatch: 'MATCH_INTERNAL_ADDRESS',
        logging: false,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;version=38.0',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create SNAT rule: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      
      if (response.headers.get('location')) {
        const taskUrl = response.headers.get('location');
        if (taskUrl) {
          await this.waitForTask(taskUrl);
        }
      }

      log(`SNAT rule created: ${result.id}`, 'vcd-client');
      return { id: result.id };
    } catch (error) {
      log(`Error creating SNAT rule: ${error}`, 'vcd-client');
      throw error;
    }
  }
}
