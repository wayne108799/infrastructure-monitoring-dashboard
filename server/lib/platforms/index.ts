import { log } from '../../index';
import type { PlatformClient, PlatformConfig, PlatformType } from './types';
import { VcdAdapter } from './vcdAdapter';
import { CloudStackClient } from './cloudstackClient';
import { ProxmoxClient } from './proxmoxClient';
import { VeeamOneClient } from './veeamClient';

export * from './types';
export { VcdAdapter } from './vcdAdapter';
export { CloudStackClient } from './cloudstackClient';
export { ProxmoxClient } from './proxmoxClient';
export { VeeamOneClient } from './veeamClient';

/**
 * Platform Client Factory
 * Creates appropriate client based on platform type
 */
export function createPlatformClient(config: PlatformConfig): PlatformClient {
  switch (config.type) {
    case 'vcd':
      return new VcdAdapter(config);
    case 'cloudstack':
      return new CloudStackClient(config);
    case 'proxmox':
      return new ProxmoxClient(config);
    case 'veeam':
      return new VeeamOneClient({
        id: config.id,
        name: config.name,
        location: config.location,
        url: config.url,
        username: config.username,
        password: config.password,
      });
    default:
      throw new Error(`Unknown platform type: ${config.type}`);
  }
}

/**
 * Platform Client Registry
 * Manages all configured platform clients
 */
export class PlatformRegistry {
  private clients: Map<string, PlatformClient> = new Map();

  /**
   * Initialize clients from environment variables
   * Supports multiple platforms with format:
   * - VCD_SITES=site1,site2 + VCD_SITE1_URL, VCD_SITE1_USERNAME, etc.
   * - CLOUDSTACK_SITES=site1,site2 + CLOUDSTACK_SITE1_URL, etc.
   * - PROXMOX_SITES=site1,site2 + PROXMOX_SITE1_URL, etc.
   */
  initializeFromEnv(): void {
    // Initialize VCD sites
    this.initializePlatformSites('vcd', 'VCD');
    
    // Initialize CloudStack sites
    this.initializePlatformSites('cloudstack', 'CLOUDSTACK');
    
    // Initialize Proxmox sites
    this.initializePlatformSites('proxmox', 'PROXMOX');
    
    // Initialize Veeam ONE sites
    this.initializePlatformSites('veeam', 'VEEAM');
  }

  private initializePlatformSites(platformType: PlatformType, envPrefix: string): void {
    const sitesEnv = process.env[`${envPrefix}_SITES`] || '';
    const siteIds = sitesEnv.split(',').map(s => s.trim()).filter(Boolean);

    if (siteIds.length === 0) {
      log(`No ${platformType.toUpperCase()} sites configured.`, 'platform-registry');
      return;
    }

    for (const siteId of siteIds) {
      const upperSiteId = siteId.toUpperCase();
      const url = process.env[`${envPrefix}_${upperSiteId}_URL`];
      const username = process.env[`${envPrefix}_${upperSiteId}_USERNAME`];
      const password = process.env[`${envPrefix}_${upperSiteId}_PASSWORD`];
      const name = process.env[`${envPrefix}_${upperSiteId}_NAME`] || siteId;
      const location = process.env[`${envPrefix}_${upperSiteId}_LOCATION`] || 'Unknown';

      // Platform-specific optional fields
      const org = process.env[`${envPrefix}_${upperSiteId}_ORG`]; // VCD
      const apiKey = process.env[`${envPrefix}_${upperSiteId}_API_KEY`]; // CloudStack
      const secretKey = process.env[`${envPrefix}_${upperSiteId}_SECRET_KEY`]; // CloudStack
      const realm = process.env[`${envPrefix}_${upperSiteId}_REALM`]; // Proxmox

      if (!url) {
        log(`Missing URL for ${platformType} site: ${siteId}. Skipping.`, 'platform-registry');
        continue;
      }

      // Validate required credentials based on platform type
      if (platformType === 'cloudstack') {
        if (!apiKey || !secretKey) {
          log(`Missing API key/secret for CloudStack site: ${siteId}. Skipping.`, 'platform-registry');
          continue;
        }
      } else if (!username || !password) {
        log(`Missing credentials for ${platformType} site: ${siteId}. Skipping.`, 'platform-registry');
        continue;
      }

      const config: PlatformConfig = {
        type: platformType,
        id: siteId,
        name,
        location,
        url,
        username: username || '',
        password: password || '',
        org,
        apiKey,
        secretKey,
        realm,
      };

      try {
        const client = createPlatformClient(config);
        const clientId = `${platformType}:${siteId}`;
        this.clients.set(clientId, client);
        log(`Initialized ${platformType.toUpperCase()} client for site: ${siteId}`, 'platform-registry');
      } catch (error) {
        log(`Failed to create ${platformType} client for ${siteId}: ${error}`, 'platform-registry');
      }
    }
  }

  /**
   * Get all clients
   */
  getAllClients(): Map<string, PlatformClient> {
    return this.clients;
  }

  /**
   * Get clients by platform type
   */
  getClientsByType(type: PlatformType): PlatformClient[] {
    return Array.from(this.clients.entries())
      .filter(([key]) => key.startsWith(`${type}:`))
      .map(([_, client]) => client);
  }

  /**
   * Get a specific client by composite ID (platform:siteId)
   */
  getClient(clientId: string): PlatformClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get a client by site ID (searches across all platforms)
   */
  getClientBySiteId(siteId: string): PlatformClient | undefined {
    for (const [key, client] of Array.from(this.clients.entries())) {
      if (key.endsWith(`:${siteId}`)) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Get all site information
   */
  getAllSites(): Array<{ id: string; platformType: PlatformType; info: ReturnType<PlatformClient['getSiteInfo']> }> {
    return Array.from(this.clients.entries()).map(([id, client]) => ({
      id,
      platformType: client.getPlatformType(),
      info: client.getSiteInfo(),
    }));
  }

  /**
   * Add a site from database configuration
   */
  addSiteFromConfig(siteConfig: {
    siteId: string;
    platformType: string;
    name: string;
    location: string;
    url: string;
    username?: string | null;
    password?: string | null;
    org?: string | null;
    apiKey?: string | null;
    secretKey?: string | null;
    realm?: string | null;
    isEnabled?: boolean | null;
  }): void {
    if (siteConfig.isEnabled === false) {
      log(`Site ${siteConfig.siteId} is disabled. Skipping.`, 'platform-registry');
      return;
    }

    const platformType = siteConfig.platformType as PlatformType;
    const clientId = `${platformType}:${siteConfig.siteId}`;

    if (this.clients.has(clientId)) {
      log(`Site ${siteConfig.siteId} already exists. Removing old client.`, 'platform-registry');
      this.clients.delete(clientId);
    }

    const config: PlatformConfig = {
      type: platformType,
      id: siteConfig.siteId,
      name: siteConfig.name,
      location: siteConfig.location,
      url: siteConfig.url,
      username: siteConfig.username || '',
      password: siteConfig.password || '',
      org: siteConfig.org || undefined,
      apiKey: siteConfig.apiKey || undefined,
      secretKey: siteConfig.secretKey || undefined,
      realm: siteConfig.realm || undefined,
    };

    try {
      const client = createPlatformClient(config);
      this.clients.set(clientId, client);
      log(`Added ${platformType.toUpperCase()} client for site: ${siteConfig.siteId}`, 'platform-registry');
    } catch (error) {
      log(`Failed to create ${platformType} client for ${siteConfig.siteId}: ${error}`, 'platform-registry');
    }
  }

  /**
   * Remove a site from the registry
   */
  removeSite(siteId: string, platformType: PlatformType): void {
    const clientId = `${platformType}:${siteId}`;
    if (this.clients.has(clientId)) {
      this.clients.delete(clientId);
      log(`Removed ${platformType.toUpperCase()} client for site: ${siteId}`, 'platform-registry');
    }
  }

  /**
   * Initialize sites from database
   */
  async initializeFromDatabase(sites: Array<{
    siteId: string;
    platformType: string;
    name: string;
    location: string;
    url: string;
    username?: string | null;
    password?: string | null;
    org?: string | null;
    apiKey?: string | null;
    secretKey?: string | null;
    realm?: string | null;
    isEnabled?: boolean | null;
  }>): Promise<void> {
    log(`Loading ${sites.length} sites from database...`, 'platform-registry');
    for (const site of sites) {
      this.addSiteFromConfig(site);
    }
  }
}

// Global registry instance
export const platformRegistry = new PlatformRegistry();
