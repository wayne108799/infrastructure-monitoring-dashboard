import { 
  PlatformClient, 
  PlatformConfig, 
  SiteInfo, 
  SiteSummary, 
  TenantAllocation,
  BackupMetrics,
  BackupRepository,
  VeeamSiteSummary
} from './types';

function log(message: string, context: string = 'veeam-client') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${timestamp} [${context}] ${message}`);
}

export interface VeeamConfig {
  id: string;
  name: string;
  location: string;
  url: string;
  username: string;
  password: string;
}

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export class VeeamOneClient implements PlatformClient {
  private config: VeeamConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config: VeeamConfig) {
    this.config = {
      ...config,
      url: config.url.replace(/\/$/, ''),
    };
  }

  getPlatformType(): 'veeam' {
    return 'veeam';
  }

  getSiteInfo(): SiteInfo {
    return {
      id: this.config.id,
      name: this.config.name,
      location: this.config.location,
      url: this.config.url,
      platformType: 'veeam',
      status: 'online',
    };
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60000) {
      return this.tokenCache.accessToken;
    }

    log(`Authenticating with Veeam ONE: ${this.config.url}`);
    
    const tokenUrl = `${this.config.url}/api/token`;
    const body = new URLSearchParams({
      grant_type: 'password',
      username: this.config.username,
      password: this.config.password,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Veeam authentication failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    this.tokenCache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    log('Veeam ONE authentication successful');
    return this.tokenCache.accessToken;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const token = await this.getToken();
    const url = `${this.config.url}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Veeam API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async authenticate(): Promise<void> {
    await this.getToken();
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch (error) {
      log(`Connection test failed: ${error}`);
      return false;
    }
  }

  async getProtectedVMs(): Promise<any[]> {
    try {
      const response = await this.request<any>('/api/infrastructure/protectedVirtualMachines');
      return Array.isArray(response) ? response : response.items || response.data || [];
    } catch (error) {
      log(`Error fetching protected VMs: ${error}`);
      return [];
    }
  }

  async getRepositories(): Promise<BackupRepository[]> {
    try {
      const response = await this.request<any>('/api/backupInfrastructure/repositories');
      const repos = Array.isArray(response) ? response : response.items || response.data || [];
      
      return repos.map((repo: any) => {
        const capacityGB = Number(repo.capacityGB || repo.capacity) || 0;
        const usedSpaceGB = Number(repo.usedSpaceGB || repo.usedSpace) || 0;
        const freeSpaceGB = Number(repo.freeGB || repo.freeSpace) || Math.max(0, capacityGB - usedSpaceGB);
        const usagePercentage = capacityGB > 0 
          ? Math.min(100, Math.round((usedSpaceGB / capacityGB) * 100)) 
          : 0;
        
        return {
          id: repo.id || repo.uid || '',
          name: repo.name || 'Unknown',
          capacityGB,
          usedSpaceGB,
          freeSpaceGB,
          usagePercentage,
        };
      });
    } catch (error) {
      log(`Error fetching repositories: ${error}`);
      return [];
    }
  }

  async getBackupMetrics(): Promise<BackupMetrics> {
    try {
      const protectedVMs = await this.getProtectedVMs();
      
      let protectedCount = 0;
      let unprotectedCount = 0;
      
      for (const vm of protectedVMs) {
        const status = vm.protectionStatus?.toLowerCase() || '';
        const isProtected = vm.isProtected === true || 
                           status === 'protected' || 
                           status === 'success' ||
                           status === 'ok';
        
        if (isProtected) {
          protectedCount++;
        } else {
          unprotectedCount++;
        }
      }
      
      const totalCount = protectedVMs.length;

      return {
        protectedVmCount: protectedCount,
        unprotectedVmCount: unprotectedCount,
        totalVmCount: totalCount,
        protectionPercentage: totalCount > 0 
          ? Math.round((protectedCount / totalCount) * 100) 
          : 0,
      };
    } catch (error) {
      log(`Error calculating backup metrics: ${error}`);
      return {
        protectedVmCount: 0,
        unprotectedVmCount: 0,
        totalVmCount: 0,
        protectionPercentage: 0,
      };
    }
  }

  async getVeeamSummary(): Promise<VeeamSiteSummary> {
    const [backupMetrics, repositories] = await Promise.all([
      this.getBackupMetrics(),
      this.getRepositories(),
    ]);

    const totalCapacity = repositories.reduce((sum, r) => sum + r.capacityGB, 0);
    const totalUsed = repositories.reduce((sum, r) => sum + r.usedSpaceGB, 0);
    const totalFree = repositories.reduce((sum, r) => sum + r.freeSpaceGB, 0);

    return {
      siteId: this.config.id,
      platformType: 'veeam',
      backup: backupMetrics,
      repositories,
      totalRepositoryCapacityGB: totalCapacity,
      totalRepositoryUsedGB: totalUsed,
      totalRepositoryFreeGB: totalFree,
    };
  }

  async getSiteSummary(): Promise<SiteSummary> {
    const veeamSummary = await this.getVeeamSummary();
    
    return {
      siteId: this.config.id,
      platformType: 'veeam',
      totalTenants: 0,
      totalVms: veeamSummary.backup.totalVmCount,
      runningVms: veeamSummary.backup.protectedVmCount,
      cpu: {
        capacity: 0,
        allocated: 0,
        used: 0,
        available: 0,
        units: 'MHz',
      },
      memory: {
        capacity: 0,
        allocated: 0,
        used: 0,
        available: 0,
        units: 'MB',
      },
      storage: {
        capacity: veeamSummary.totalRepositoryCapacityGB * 1024,
        limit: veeamSummary.totalRepositoryCapacityGB * 1024,
        used: veeamSummary.totalRepositoryUsedGB * 1024,
        available: veeamSummary.totalRepositoryFreeGB * 1024,
        units: 'MB',
      },
      network: {
        totalIps: 0,
        allocatedIps: 0,
        usedIps: 0,
        freeIps: 0,
      },
    };
  }

  async getTenantAllocations(): Promise<TenantAllocation[]> {
    return [];
  }

  async getTenantAllocation(tenantId: string): Promise<TenantAllocation | null> {
    return null;
  }
}
