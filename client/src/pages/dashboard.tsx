import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Cpu, HardDrive, Database, Globe, Server, Activity, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  fetchSites, 
  fetchSiteSummary, 
  fetchPlatforms,
  getPlatformShortName,
  getPlatformColor,
  type Site, 
  type SiteSummary,
  type PlatformType 
} from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer,
  Tooltip,
  Legend
} from 'recharts';

interface SiteData {
  site: Site;
  summary: SiteSummary | null;
}

export default function Dashboard() {
  const [platformFilter, setPlatformFilter] = useState<PlatformType | 'all'>('all');

  const { data: platforms } = useQuery({
    queryKey: ['platforms'],
    queryFn: fetchPlatforms,
    staleTime: 5 * 60 * 1000,
  });

  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetchSites(),
    staleTime: 5 * 60 * 1000,
  });

  const filteredSites = sites?.filter(site => 
    platformFilter === 'all' || site.platformType === platformFilter
  ) || [];

  const { data: allSiteSummaries, isLoading: summariesLoading } = useQuery({
    queryKey: ['allSiteSummaries', filteredSites?.map(s => s.id)],
    queryFn: async () => {
      if (!filteredSites || filteredSites.length === 0) return [];
      const summaries = await Promise.all(
        filteredSites.map(async (site) => {
          try {
            const summary = await fetchSiteSummary(site.id);
            return { site, summary };
          } catch (e) {
            return { site, summary: null };
          }
        })
      );
      return summaries;
    },
    enabled: filteredSites.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const toGHz = (mhz: number) => Math.round(mhz / 1000);
  const toGB = (mb: number) => Math.round(mb / 1024);
  const toTB = (mb: number) => parseFloat((mb / 1024 / 1024).toFixed(1));

  if (sitesError) {
    return (
      <DashboardLayout>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to connect to infrastructure platforms. Please check your configuration in the Secrets tab.
            <br />
            <span className="text-xs mt-2 block">Error: {(sitesError as Error).message}</span>
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    );
  }

  if (sitesLoading || !sites) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-muted-foreground">Connecting to platforms...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (sites.length === 0) {
    return (
      <DashboardLayout>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No Sites Configured</AlertTitle>
          <AlertDescription>
            Please configure your virtualization platform sites in the Secrets tab.
            <br />
            <span className="text-sm mt-2 block text-muted-foreground">
              Supported platforms: VMware Cloud Director (VCD), Apache CloudStack, Proxmox VE
            </span>
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    );
  }

  const totalVdcs = allSiteSummaries?.reduce((sum, { summary }) => sum + (summary?.totalVdcs || 0), 0) || 0;
  const totalVms = allSiteSummaries?.reduce((sum, { summary }) => sum + (summary?.totalVms || 0), 0) || 0;
  const runningVms = allSiteSummaries?.reduce((sum, { summary }) => sum + (summary?.runningVms || 0), 0) || 0;

  const validSummaries = allSiteSummaries?.filter(({ summary }) => summary !== null) || [];

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="text-sm font-medium">{payload[0].name}</p>
          <p className="text-sm text-muted-foreground">{payload[0].value.toLocaleString()}</p>
        </div>
      );
    }
    return null;
  };

  const PlatformBadge = ({ type }: { type: PlatformType }) => (
    <Badge 
      variant="outline" 
      className="text-xs font-medium"
      style={{ 
        borderColor: getPlatformColor(type),
        color: getPlatformColor(type),
      }}
      data-testid={`badge-platform-${type}`}
    >
      {getPlatformShortName(type)}
    </Badge>
  );

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Infrastructure Overview</h1>
        <p className="text-muted-foreground mt-1">Resource utilization across all virtualization platforms.</p>
      </div>

      {/* Platform Filter */}
      {platforms && platforms.length > 1 && (
        <div className="mb-6 flex items-center gap-2" data-testid="platform-filter">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filter:</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPlatformFilter('all')}
              className={cn(
                "px-3 py-1 rounded-md text-sm font-medium transition-colors",
                platformFilter === 'all' 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-muted hover:bg-muted/80"
              )}
              data-testid="filter-all"
            >
              All Platforms
            </button>
            {platforms.map(platform => (
              <button
                key={platform.type}
                onClick={() => setPlatformFilter(platform.type)}
                className={cn(
                  "px-3 py-1 rounded-md text-sm font-medium transition-colors",
                  platformFilter === platform.type 
                    ? "text-white" 
                    : "bg-muted hover:bg-muted/80"
                )}
                style={platformFilter === platform.type ? { backgroundColor: getPlatformColor(platform.type) } : {}}
                data-testid={`filter-${platform.type}`}
              >
                {getPlatformShortName(platform.type)} ({platform.siteCount})
              </button>
            ))}
          </div>
        </div>
      )}

      {summariesLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-2 text-sm text-muted-foreground">Loading site data...</p>
          </div>
        </div>
      )}

      {!summariesLoading && allSiteSummaries && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center justify-between pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Total Sites</h3>
                  <Server className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-bold font-mono" data-testid="text-total-sites">{filteredSites.length}</div>
                <p className="text-xs text-muted-foreground mt-1">{totalVdcs} Tenant Allocations</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center justify-between pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Virtual Machines</h3>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-bold font-mono" data-testid="text-total-vms">{totalVms}</div>
                <p className="text-xs text-muted-foreground mt-1">{runningVms} Running / {totalVms - runningVms} Stopped</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center justify-between pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Sites Status</h3>
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {filteredSites.map(site => (
                    <div key={site.id} className="flex items-center gap-1.5" data-testid={`site-status-${site.id}`}>
                      <div className={`w-2 h-2 rounded-full ${site.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-sm font-medium">{site.name}</span>
                      <PlatformBadge type={site.platformType} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {validSummaries.map(({ site, summary }) => (
            <div key={site.id} className="mb-8" data-testid={`site-section-${site.id}`}>
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                {site.name} - {site.location}
                <PlatformBadge type={site.platformType} />
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-cyan-500" />
                      CPU
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Used', value: toGHz(summary!.cpu.used), fill: '#22c55e' },
                              { name: 'Available', value: Math.max(0, toGHz(summary!.cpu.capacity) - toGHz(summary!.cpu.used)), fill: '#64748b' },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                          >
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-center text-sm text-muted-foreground mt-2">
                      <span className="font-mono">{toGHz(summary!.cpu.used)}</span> / <span className="font-mono">{toGHz(summary!.cpu.capacity)}</span> GHz
                    </div>
                    <div className="text-center text-xs text-muted-foreground">
                      Allocated: <span className="font-mono text-cyan-500">{toGHz(summary!.cpu.allocated)} GHz</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-purple-500" />
                      Memory
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Used', value: toGB(summary!.memory.used), fill: '#22c55e' },
                              { name: 'Available', value: Math.max(0, toGB(summary!.memory.capacity) - toGB(summary!.memory.used)), fill: '#64748b' },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                          >
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-center text-sm text-muted-foreground mt-2">
                      <span className="font-mono">{toGB(summary!.memory.used)}</span> / <span className="font-mono">{toGB(summary!.memory.capacity)}</span> GB
                    </div>
                    <div className="text-center text-xs text-muted-foreground">
                      Allocated: <span className="font-mono text-purple-500">{toGB(summary!.memory.allocated)} GB</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Database className="h-4 w-4 text-emerald-500" />
                      Storage
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Used', value: toTB(summary!.storage.used), fill: '#10b981' },
                              { name: 'Available', value: toTB(summary!.storage.available), fill: '#64748b' },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                          >
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-center text-sm text-muted-foreground mt-2">
                      <span className="font-mono">{toTB(summary!.storage.used)}</span> / <span className="font-mono">{toTB(summary!.storage.capacity)}</span> TB
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Globe className="h-4 w-4 text-orange-500" />
                      Public IPs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Allocated', value: summary!.network?.allocatedIps || 0, fill: '#f97316' },
                              { name: 'Available', value: summary!.network?.freeIps || 0, fill: '#64748b' },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={70}
                            paddingAngle={2}
                            dataKey="value"
                          >
                          </Pie>
                          <Tooltip content={<CustomTooltip />} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-center text-sm text-muted-foreground mt-2">
                      <span className="font-mono">{summary!.network?.allocatedIps || 0}</span> / <span className="font-mono">{summary!.network?.totalIps || 0}</span> IPs
                    </div>
                    <div className="text-center text-xs text-muted-foreground">
                      In Use: <span className="font-mono text-orange-500">{summary!.network?.usedIps || 0}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ))}
        </>
      )}
    </DashboardLayout>
  );
}
