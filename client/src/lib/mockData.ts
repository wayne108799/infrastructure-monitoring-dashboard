export interface ResourceUsage {
  used: number;
  reserved: number;
  available: number;
  total: number;
  unit: string;
}

export interface VDC {
  id: string;
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  cpu: ResourceUsage;
  memory: ResourceUsage;
  storage: ResourceUsage;
  vms: number;
}

export interface Site {
  id: string;
  name: string;
  location: string;
  status: 'online' | 'offline' | 'degraded';
  vdcs: VDC[];
}

export const mockSites: Site[] = [
  {
    id: 'site-ny-01',
    name: 'US-East Primary',
    location: 'New York, NY',
    status: 'online',
    vdcs: [
      {
        id: 'vdc-fin-01',
        name: 'Finance Prod',
        status: 'healthy',
        vms: 142,
        cpu: { used: 450, reserved: 600, available: 400, total: 1000, unit: 'GHz' },
        memory: { used: 2.4, reserved: 3.0, available: 1.6, total: 4.0, unit: 'TB' },
        storage: { used: 145, reserved: 180, available: 320, total: 500, unit: 'TB' }
      },
      {
        id: 'vdc-hr-01',
        name: 'HR Systems',
        status: 'warning',
        vms: 45,
        cpu: { used: 180, reserved: 190, available: 10, total: 200, unit: 'GHz' },
        memory: { used: 0.8, reserved: 0.8, available: 0.2, total: 1.0, unit: 'TB' },
        storage: { used: 40, reserved: 50, available: 150, total: 200, unit: 'TB' }
      }
    ]
  },
  {
    id: 'site-ldn-01',
    name: 'EU-West Hub',
    location: 'London, UK',
    status: 'online',
    vdcs: [
      {
        id: 'vdc-dev-01',
        name: 'DevOps Cluster',
        status: 'healthy',
        vms: 310,
        cpu: { used: 890, reserved: 1000, available: 1000, total: 2000, unit: 'GHz' },
        memory: { used: 5.2, reserved: 6.0, available: 2.0, total: 8.0, unit: 'TB' },
        storage: { used: 600, reserved: 800, available: 1200, total: 2000, unit: 'TB' }
      }
    ]
  },
  {
    id: 'site-sg-01',
    name: 'APAC Gateway',
    location: 'Singapore',
    status: 'degraded',
    vdcs: [
      {
        id: 'vdc-legacy-01',
        name: 'Legacy Ops',
        status: 'critical',
        vms: 8,
        cpu: { used: 95, reserved: 100, available: 0, total: 100, unit: 'GHz' },
        memory: { used: 0.45, reserved: 0.5, available: 0.05, total: 0.5, unit: 'TB' },
        storage: { used: 98, reserved: 100, available: 2, total: 100, unit: 'TB' }
      }
    ]
  }
];
