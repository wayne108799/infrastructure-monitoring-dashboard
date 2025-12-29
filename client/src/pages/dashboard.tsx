import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Cpu, HardDrive, Database, Globe, Server, Activity, Filter, Download, Loader2, ExternalLink, RefreshCw, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  fetchSites, 
  fetchSiteSummary, 
  fetchPlatforms,
  exportTenantsCSV,
  fetchPollingStatus,
  triggerPoll,
  fetchAllStorageConfigs,
  getPlatformShortName,
  getPlatformColor,
  type Site, 
  type SiteSummary,
  type PlatformType,
  type PollingStatus,
  type SiteStorageConfig
} from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
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
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportTenantsCSV();
      toast({
        title: 'Export Complete',
        description: 'Tenant data has been downloaded as CSV.',
      });
    } catch (error: any) {
      toast({
        title: 'Export Failed',
        description: error.message || 'Could not export tenant data.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const [isPolling, setIsPolling] = useState(false);

  const { data: pollingStatus, refetch: refetchPollingStatus } = useQuery({
    queryKey: ['pollingStatus'],
    queryFn: fetchPollingStatus,
    staleTime: 60 * 1000,
  });

  const queryClient = useQueryClient();
  
  const handleTriggerPoll = async () => {
    setIsPolling(true);
    try {
      await triggerPoll();
      toast({
        title: 'Poll Started',
        description: 'Data collection has started. The page will refresh automatically when complete.',
      });
      // Wait for polling to complete, then refetch data
      setTimeout(async () => {
        refetchPollingStatus();
        // Invalidate all site data to force refetch
        queryClient.invalidateQueries({ queryKey: ['allSiteSummaries'] });
        queryClient.invalidateQueries({ queryKey: ['sites'] });
      }, 10000);
    } catch (error: any) {
      toast({
        title: 'Poll Failed',
        description: error.message || 'Could not trigger data poll.',
        variant: 'destructive',
      });
    } finally {
      setIsPolling(false);
    }
  };

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

  const siteIds = filteredSites.map(s => s.id).join(',');
  
  const { data: allSiteSummaries, isLoading: summariesLoading } = useQuery({
    queryKey: ['allSiteSummaries', siteIds],
    queryFn: async () => {
      if (!filteredSites || filteredSites.length === 0) return [];
      const summaries = await Promise.all(
        filteredSites.map(async (site) => {
          try {
            const summary = await fetchSiteSummary(site.id);
            return { site, summary };
          } catch (e) {
            console.log(`Failed to fetch summary for ${site.id}:`, e);
            return { site, summary: null };
          }
        })
      );
      return summaries;
    },
    enabled: filteredSites.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
  });

  // Fetch storage configs for all sites
  const { data: storageConfigs = {} } = useQuery({
    queryKey: ['allStorageConfigs'],
    queryFn: fetchAllStorageConfigs,
    staleTime: 5 * 60 * 1000,
  });

  // Helper to get configured storage capacity for a site
  const getConfiguredStorageCapacity = (siteId: string): number | null => {
    const configs = storageConfigs[siteId];
    if (!configs || configs.length === 0) return null;
    // Sum all configured tier capacities (in GB, convert to MB for consistency)
    return configs.reduce((total, c) => total + c.usableCapacityGB * 1024, 0);
  };

  const CPU_OVERCOMMIT_RATIO = 3; // 3:1 overcommit ratio
  const toVcpu = (mhz: number) => Math.round(mhz / 2800); // 2800 MHz per vCPU
  const toAllocatableVcpu = (mhz: number) => Math.round((mhz / 2800) * CPU_OVERCOMMIT_RATIO); // With 3:1 overcommit
  const toGB = (mb: number) => Math.round(mb / 1024);
  const toTB = (mb: number) => parseFloat((mb / 1024 / 1024).toFixed(1));

  if (sitesError) {
    return (
      <DashboardLayout>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to connect to infrastructure platforms. Please check your configuration in{' '}
            <a href="/settings" className="underline font-medium">Settings</a>.
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
            Please configure your virtualization platform sites in{' '}
            <a href="/settings" className="underline font-medium">Settings</a>.
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
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Infrastructure Overview</h1>
          <p className="text-muted-foreground mt-1">Resource utilization across all virtualization platforms.</p>
          {pollingStatus?.lastPollTime && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last updated: {new Date(pollingStatus.lastPollTime).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleTriggerPoll} 
            disabled={isPolling}
            variant="outline"
            size="sm"
            data-testid="button-refresh-data"
          >
            {isPolling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh Data
          </Button>
          <Button 
            onClick={handleExport} 
            disabled={isExporting}
            variant="outline"
            data-testid="button-export"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export Tenants
          </Button>
        </div>
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
              <div className="mb-4">
                <h2 className="text-xl font-semibold flex items-center gap-2 flex-wrap">
                  <Server className="h-5 w-5 text-primary" />
                  {site.name} - {site.location}
                  <PlatformBadge type={site.platformType} />
                  {/* Management Links - inline badges */}
                  {site.managementLinks && (
                    <>
                      {site.managementLinks.vcenter && (
                        <a 
                          href={site.managementLinks.vcenter.startsWith('http') ? site.managementLinks.vcenter : `https://${site.managementLinks.vcenter}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 rounded border border-green-500 text-green-400 hover:bg-green-500/20 flex items-center gap-1"
                          data-testid={`link-vcenter-${site.id}`}
                        >
                          <ExternalLink className="h-3 w-3" /> vCenter
                        </a>
                      )}
                      {site.managementLinks.nsx && (
                        <a 
                          href={site.managementLinks.nsx.startsWith('http') ? site.managementLinks.nsx : `https://${site.managementLinks.nsx}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 rounded border border-purple-500 text-purple-400 hover:bg-purple-500/20 flex items-center gap-1"
                          data-testid={`link-nsx-${site.id}`}
                        >
                          <ExternalLink className="h-3 w-3" /> NSX
                        </a>
                      )}
                      {site.managementLinks.aria && (
                        <a 
                          href={site.managementLinks.aria.startsWith('http') ? site.managementLinks.aria : `https://${site.managementLinks.aria}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 rounded border border-orange-500 text-orange-400 hover:bg-orange-500/20 flex items-center gap-1"
                          data-testid={`link-aria-${site.id}`}
                        >
                          <ExternalLink className="h-3 w-3" /> Aria
                        </a>
                      )}
                      {site.managementLinks.veeam && (
                        <a 
                          href={site.managementLinks.veeam.startsWith('http') ? site.managementLinks.veeam : `https://${site.managementLinks.veeam}`}
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 rounded border border-teal-500 text-teal-400 hover:bg-teal-500/20 flex items-center gap-1"
                          data-testid={`link-veeam-${site.id}`}
                        >
                          <ExternalLink className="h-3 w-3" /> Veeam
                        </a>
                      )}
                    </>
                  )}
                </h2>
              </div>
              
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
                              { name: 'Used', value: Math.min(toVcpu(summary!.cpu.used), toAllocatableVcpu(summary!.cpu.capacity)), fill: '#22c55e' },
                              { name: 'Available', value: Math.max(0, toAllocatableVcpu(summary!.cpu.capacity) - toVcpu(summary!.cpu.used)), fill: '#64748b' },
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
                      <span className="font-mono">{toVcpu(summary!.cpu.used)}</span> / <span className="font-mono">{toAllocatableVcpu(summary!.cpu.capacity)}</span> vCPU
                    </div>
                    <div className="text-center text-xs text-muted-foreground">
                      3:1 Allocatable <span className="text-muted-foreground/70">({toVcpu(summary!.cpu.capacity)} physical)</span>
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
                      Storage by Tier
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(() => {
                      const tiers = summary!.storageTiers || [];
                      const configs = storageConfigs[site.id] || [];
                      const tierColors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4'];
                      
                      if (tiers.length === 0) {
                        const storageUsed = summary!.storage.used;
                        const storageCapacity = summary!.storage.capacity;
                        return (
                          <div className="text-center text-sm text-muted-foreground py-8">
                            <span className="font-mono">{toTB(storageUsed)}</span> / <span className="font-mono">{toTB(storageCapacity)}</span> TB total
                          </div>
                        );
                      }
                      
                      return (
                        <div className="space-y-3 max-h-[220px] overflow-y-auto">
                          {tiers.map((tier, idx) => {
                            const config = configs.find(c => c.tierName === tier.name);
                            const capacity = config ? config.usableCapacityGB * 1024 : tier.capacity;
                            const usedPct = capacity > 0 ? Math.min(100, (tier.used / capacity) * 100) : 0;
                            const color = tierColors[idx % tierColors.length];
                            
                            return (
                              <div key={tier.name} className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span className="font-medium truncate max-w-[120px]" title={tier.name}>
                                    {tier.name}
                                  </span>
                                  <span className="text-muted-foreground font-mono">
                                    {toTB(tier.used)} / {toTB(capacity)} TB
                                    {config && <span className="text-emerald-500 ml-1">*</span>}
                                  </span>
                                </div>
                                <div className="h-2 bg-muted rounded-full overflow-hidden">
                                  <div 
                                    className="h-full rounded-full transition-all"
                                    style={{ 
                                      width: `${usedPct}%`, 
                                      backgroundColor: usedPct > 90 ? '#ef4444' : usedPct > 75 ? '#f59e0b' : color 
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
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
