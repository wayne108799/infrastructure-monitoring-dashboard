import { BackupMetrics } from './types';

function log(message: string, context: string = 'vspc-client') {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${timestamp} [${context}] ${message}`);
}

export interface VspcConfig {
  url: string;
  username: string;
  password: string;
}

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface VspcCompany {
  instanceUid: string;
  name: string;
  status?: string;
}

export interface VspcBackupUsage {
  companyUid: string;
  companyName: string;
  protectedVmCount: number;
  totalVmCount: number;
  backupSizeBytes: number;
  usedPointsCount?: number;
}

export interface VspcOrgBackupMetrics {
  orgId: string;
  orgName: string;
  protectedVmCount: number;
  totalVmCount: number;
  backupSizeGB: number;
  protectionPercentage: number;
}

export class VspcClient {
  private config: VspcConfig;
  private tokenCache: TokenCache | null = null;

  constructor(config: VspcConfig) {
    this.config = {
      ...config,
      url: config.url.replace(/\/$/, ''),
    };
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60000) {
      return this.tokenCache.accessToken;
    }

    log(`Authenticating with VSPC: ${this.config.url}`);
    
    const tokenUrl = `${this.config.url}/api/v3/token`;
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
      throw new Error(`VSPC authentication failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    this.tokenCache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    log('VSPC authentication successful');
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
      throw new Error(`VSPC API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.getToken();
      return { success: true };
    } catch (error: any) {
      log(`VSPC connection test failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async getCompanies(): Promise<VspcCompany[]> {
    try {
      const response = await this.request<any>('/api/v3/organizations/companies');
      const companies = response.data || response.items || response || [];
      log(`Fetched ${companies.length} companies from VSPC`);
      return companies.map((c: any) => ({
        instanceUid: c.instanceUid || c.uid || c.id,
        name: c.name,
        status: c.status,
      }));
    } catch (error: any) {
      log(`Error fetching VSPC companies: ${error.message}`);
      return [];
    }
  }

  async getBackupUsageByCompany(): Promise<Map<string, VspcBackupUsage>> {
    const usageMap = new Map<string, VspcBackupUsage>();
    
    try {
      const [companies, jobs] = await Promise.all([
        this.getCompanies(),
        this.getBackupJobs(),
      ]);

      const companyMap = new Map(companies.map(c => [c.instanceUid, c]));

      for (const job of jobs) {
        const companyUid = job.mappedOrganizationUid;
        if (!companyUid) continue;

        const company = companyMap.get(companyUid);
        if (!company) continue;

        if (!usageMap.has(companyUid)) {
          usageMap.set(companyUid, {
            companyUid,
            companyName: company.name,
            protectedVmCount: 0,
            totalVmCount: 0,
            backupSizeBytes: job.backupChainSize || 0,
          });
        } else {
          const existing = usageMap.get(companyUid)!;
          existing.backupSizeBytes += job.backupChainSize || 0;
        }
      }

      const protectedWorkloads = await this.getProtectedWorkloads();
      for (const vm of protectedWorkloads) {
        const job = jobs.find(j => j.instanceUid === vm.jobUid);
        if (!job?.mappedOrganizationUid) continue;

        const usage = usageMap.get(job.mappedOrganizationUid);
        if (usage) {
          usage.totalVmCount++;
          if (vm.isProtected || vm.status === 'Success' || vm.status === 'Protected') {
            usage.protectedVmCount++;
          }
        }
      }

      log(`Built backup usage for ${usageMap.size} companies`);
    } catch (error: any) {
      log(`Error building backup usage: ${error.message}`);
    }

    return usageMap;
  }

  private async getBackupJobs(): Promise<any[]> {
    try {
      const response = await this.request<any>('/api/v3/infrastructure/backupServers/jobs/backupVmJobs');
      return response.data || response.items || response || [];
    } catch (error: any) {
      log(`Error fetching backup jobs: ${error.message}`);
      return [];
    }
  }

  private async getProtectedWorkloads(): Promise<any[]> {
    try {
      const response = await this.request<any>('/api/v3/protectedWorkloads/virtualMachines');
      return response.data || response.items || response || [];
    } catch (error: any) {
      log(`Error fetching protected workloads: ${error.message}`);
      return [];
    }
  }

  async getBackupMetricsByOrgId(): Promise<Map<string, VspcOrgBackupMetrics>> {
    const metricsMap = new Map<string, VspcOrgBackupMetrics>();
    
    try {
      const usageByCompany = await this.getBackupUsageByCompany();
      
      for (const [companyUid, usage] of Array.from(usageByCompany.entries())) {
        const protectionPercentage = usage.totalVmCount > 0
          ? Math.round((usage.protectedVmCount / usage.totalVmCount) * 100)
          : 0;

        metricsMap.set(companyUid, {
          orgId: companyUid,
          orgName: usage.companyName,
          protectedVmCount: usage.protectedVmCount,
          totalVmCount: usage.totalVmCount,
          backupSizeGB: usage.backupSizeBytes / (1024 * 1024 * 1024),
          protectionPercentage,
        });
      }

      log(`Got backup metrics for ${metricsMap.size} organizations by ID`);
    } catch (error: any) {
      log(`Error getting backup metrics by org ID: ${error.message}`);
    }

    return metricsMap;
  }

  async getLicenseUsage(): Promise<any> {
    try {
      const [vbrUsage, agentUsage] = await Promise.all([
        this.request<any>('/api/v3/licensing/backupServers/usage/companies').catch(() => ({ data: [] })),
        this.request<any>('/api/v3/licensing/console/usage/companies').catch(() => ({ data: [] })),
      ]);

      return {
        vbrUsage: vbrUsage.data || [],
        agentUsage: agentUsage.data || [],
      };
    } catch (error: any) {
      log(`Error fetching license usage: ${error.message}`);
      return { vbrUsage: [], agentUsage: [] };
    }
  }

  async getCloudConnectUsage(): Promise<any> {
    try {
      const response = await this.request<any>('/api/v3/organizations/companies/sites/backupResources/usage');
      return response.data || response.items || response || [];
    } catch (error: any) {
      log(`Error fetching Cloud Connect usage: ${error.message}`);
      return [];
    }
  }

  async getSummary(): Promise<BackupMetrics & { companies: number; totalBackupSizeGB: number }> {
    try {
      const usageByCompany = await this.getBackupUsageByCompany();
      
      let totalProtected = 0;
      let totalVms = 0;
      let totalBackupSize = 0;

      for (const usage of Array.from(usageByCompany.values())) {
        totalProtected += usage.protectedVmCount;
        totalVms += usage.totalVmCount;
        totalBackupSize += usage.backupSizeBytes;
      }

      return {
        protectedVmCount: totalProtected,
        unprotectedVmCount: totalVms - totalProtected,
        totalVmCount: totalVms,
        protectionPercentage: totalVms > 0 ? Math.round((totalProtected / totalVms) * 100) : 0,
        companies: usageByCompany.size,
        totalBackupSizeGB: totalBackupSize / (1024 * 1024 * 1024),
      };
    } catch (error: any) {
      log(`Error getting VSPC summary: ${error.message}`);
      return {
        protectedVmCount: 0,
        unprotectedVmCount: 0,
        totalVmCount: 0,
        protectionPercentage: 0,
        companies: 0,
        totalBackupSizeGB: 0,
      };
    }
  }
}

export function createVspcClient(config: VspcConfig | null | undefined): VspcClient | null {
  if (!config?.url || !config?.username || !config?.password) {
    return null;
  }
  return new VspcClient(config);
}
