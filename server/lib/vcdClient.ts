import { log } from '../index';

// VCD 10.6 API Client

export interface VcdConfig {
  url: string;
  username: string;
  password: string;
  org: string;
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
    // Ensure URL has protocol
    let url = config.url.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    // Remove trailing slash
    url = url.replace(/\/$/, '');
    
    this.config = { ...config, url };
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

    const response = await fetch(url, {
      ...options,
      headers: {
        'Accept': 'application/json',
        'x-vcloud-authorization': token,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`VCD API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get all Organization VDCs
   */
  async getOrgVdcs(): Promise<any[]> {
    try {
      // CloudAPI endpoint for querying VDCs
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
   * Get VDC details by ID
   */
  async getVdcDetails(vdcId: string): Promise<any> {
    try {
      const response = await this.request<any>(
        `/api/admin/vdc/${vdcId}`
      );
      
      return response;
    } catch (error) {
      log(`Error fetching VDC details for ${vdcId}: ${error}`, 'vcd-client');
      throw error;
    }
  }

  /**
   * Get storage profiles for a VDC
   */
  async getVdcStorageProfiles(vdcId: string): Promise<any[]> {
    try {
      const response = await this.request<{ values: any[] }>(
        `/cloudapi/1.0.0/vdcs/${vdcId}/storageProfiles`
      );
      
      return response.values || [];
    } catch (error) {
      log(`Error fetching storage profiles for ${vdcId}: ${error}`, 'vcd-client');
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
      const [details, storageProfiles, edgeGateways] = await Promise.all([
        this.getVdcDetails(vdcId),
        this.getVdcStorageProfiles(vdcId),
        this.getEdgeGateways(vdcId)
      ]);

      // Get IP allocations from first edge gateway
      let ipAllocations = { totalIpCount: 0, usedIpCount: 0, freeIpCount: 0, subnets: [] };
      if (edgeGateways.length > 0) {
        ipAllocations = await this.getIpAllocations(edgeGateways[0].id);
      }

      return {
        ...details,
        storageProfiles,
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
