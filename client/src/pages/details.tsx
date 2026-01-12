import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { VDCDetailCard } from '@/components/dashboard/VDCDetailCard';
import { ResourceBar } from '@/components/dashboard/ResourceBar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Activity, Server, Database, Globe, Network, AlertCircle, Cpu, HardDrive, Settings2, Save, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { 
  fetchSites, 
  fetchSiteVdcs, 
  fetchSiteSummary, 
  fetchCommitLevels,
  saveCommitLevel,
  toggleTenantReporting,
  fetchVspcBackupByOrg,
  getPlatformShortName, 
  getPlatformColor,
  type Site, 
  type OrgVdc, 
  type SiteSummary,
  type TenantCommitLevel,
  type InsertTenantCommitLevel,
  type OrgBackupMetrics
} from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

export default function Details() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [editingTenant, setEditingTenant] = useState<OrgVdc | null>(null);
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitForm, setCommitForm] = useState<InsertTenantCommitLevel | null>(null);
  const queryClient = useQueryClient();

  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetchSites(),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (sites && sites.length > 0 && !selectedSiteId) {
      setSelectedSiteId(sites[0].id);
    }
  }, [sites, selectedSiteId]);

  const { data: vdcs, isLoading: vdcsLoading, error: vdcsError } = useQuery({
    queryKey: ['vdcs', selectedSiteId],
    queryFn: () => fetchSiteVdcs(selectedSiteId),
    enabled: !!selectedSiteId,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const { data: siteSummary } = useQuery({
    queryKey: ['siteSummary', selectedSiteId],
    queryFn: () => fetchSiteSummary(selectedSiteId),
    enabled: !!selectedSiteId,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const { data: commitLevels } = useQuery({
    queryKey: ['commitLevels', selectedSiteId],
    queryFn: () => fetchCommitLevels(selectedSiteId),
    enabled: !!selectedSiteId,
    staleTime: 5 * 60 * 1000,
  });

  // Find selected site to determine platform type
  const selectedSite = sites?.find(s => s.id === selectedSiteId);
  
  // Only fetch VSPC backup data for VCD sites
  const isVcdSite = selectedSite?.platformType === 'vcd';
  const { data: backupByOrg } = useQuery({
    queryKey: ['vspcBackupByOrg', selectedSiteId],
    queryFn: () => fetchVspcBackupByOrg(selectedSiteId),
    enabled: !!selectedSiteId && isVcdSite,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const commitLevelMap = new Map<string, TenantCommitLevel>();
  if (commitLevels) {
    for (const level of commitLevels) {
      commitLevelMap.set(level.tenantId, level);
    }
  }

  // Lookup backup metrics by org ID with fallback to name matching
  const getBackupMetricsForOrg = (orgId?: string, orgName?: string): OrgBackupMetrics | undefined => {
    if (!backupByOrg?.configured || !backupByOrg.organizations) return undefined;
    
    // Primary lookup: by org ID
    if (orgId && backupByOrg.organizations[orgId]) {
      return backupByOrg.organizations[orgId];
    }
    
    // Fallback: search by org name match within organization data
    if (orgName) {
      const normalizedSearch = orgName.toLowerCase().trim();
      for (const [key, metrics] of Object.entries(backupByOrg.organizations)) {
        if (metrics.orgName && metrics.orgName.toLowerCase().trim() === normalizedSearch) {
          return metrics;
        }
      }
    }
    
    return undefined;
  };

  const saveCommitMutation = useMutation({
    mutationFn: saveCommitLevel,
    onSuccess: () => {
      toast.success('Minimum commit level saved');
      queryClient.invalidateQueries({ queryKey: ['commitLevels'] });
      setCommitDialogOpen(false);
      setEditingTenant(null);
      setCommitForm(null);
    },
    onError: (error: any) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  const toggleReportingMutation = useMutation({
    mutationFn: async ({ siteId, tenantId, isDisabled, tenantName }: { siteId: string; tenantId: string; isDisabled: boolean; tenantName: string }) => {
      return toggleTenantReporting(siteId, tenantId, isDisabled, isDisabled ? 'Testing/Non-compliant' : undefined, tenantName);
    },
    onSuccess: (data, variables) => {
      toast.success(variables.isDisabled ? 'Tenant disabled from reports' : 'Tenant enabled in reports');
      queryClient.invalidateQueries({ queryKey: ['commitLevels'] });
    },
    onError: (error: any) => {
      toast.error(`Failed to toggle reporting: ${error.message}`);
    },
  });

  const handleToggleReporting = (tenant: OrgVdc, disabled: boolean) => {
    toggleReportingMutation.mutate({
      siteId: selectedSiteId,
      tenantId: tenant.id,
      isDisabled: disabled,
      tenantName: tenant.name,
    });
  };

  const openCommitDialog = (tenant: OrgVdc) => {
    const existing = commitLevelMap.get(tenant.id);
    setEditingTenant(tenant);
    setCommitForm({
      siteId: selectedSiteId,
      tenantId: tenant.id,
      tenantName: tenant.name,
      businessId: existing?.businessId || '',
      businessName: existing?.businessName || '',
      vcpuCount: existing?.vcpuCount || '',
      vcpuSpeedGhz: existing?.vcpuSpeedGhz || '',
      ramGB: existing?.ramGB || '',
      storageHpsGB: existing?.storageHpsGB || '',
      storageSpsGB: existing?.storageSpsGB || '',
      storageVvolGB: existing?.storageVvolGB || '',
      storageOtherGB: existing?.storageOtherGB || '',
      allocatedIps: existing?.allocatedIps || '',
      notes: existing?.notes || '',
    });
    setCommitDialogOpen(true);
  };

  const handleSaveCommit = () => {
    if (!commitForm || !commitForm.siteId || !commitForm.tenantId || !commitForm.tenantName) {
      toast.error('Missing required fields');
      return;
    }
    saveCommitMutation.mutate(commitForm);
  };

  const toGHz = (mhz: number) => (mhz / 1000).toFixed(0);
  const toGB = (mb: number) => (mb / 1024).toFixed(0);
  const toTB = (mb: number) => (mb / 1024 / 1024).toFixed(1);
  const toVcpu = (mhz: number) => Math.round((mhz / 2800) * 3);

  const getTenantLabel = (platformType?: string) => {
    switch (platformType) {
      case 'vcd':
        return 'Organization VDCs';
      case 'cloudstack':
        return 'Projects';
      case 'proxmox':
        return 'Nodes';
      default:
        return 'Tenants';
    }
  };

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

  return (
    <DashboardLayout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Tenant Details</h1>
          <p className="text-muted-foreground mt-1">Detailed view of tenant allocations and resource consumption.</p>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground font-medium">Select Site:</span>
          <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
            <SelectTrigger className="w-[300px] bg-card border-border" data-testid="select-site">
              <SelectValue placeholder="Select a site" />
            </SelectTrigger>
            <SelectContent>
              {sites.map(site => (
                <SelectItem key={site.id} value={site.id} data-testid={`site-option-${site.id}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${site.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-medium">{site.name}</span>
                    <Badge 
                      variant="outline" 
                      className="text-[10px] font-medium px-1.5 py-0"
                      style={{ 
                        borderColor: getPlatformColor(site.platformType),
                        color: getPlatformColor(site.platformType),
                      }}
                    >
                      {getPlatformShortName(site.platformType)}
                    </Badge>
                    <span className="text-xs text-muted-foreground ml-auto">{site.location}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedSite && (
        <div className="mb-4 flex items-center gap-2">
          <Badge 
            variant="outline" 
            className="text-xs font-medium"
            style={{ 
              borderColor: getPlatformColor(selectedSite.platformType),
              color: getPlatformColor(selectedSite.platformType),
            }}
            data-testid={`badge-selected-platform`}
          >
            {getPlatformShortName(selectedSite.platformType)}
          </Badge>
          <span className="text-sm text-muted-foreground">{selectedSite.url}</span>
        </div>
      )}

      {vdcsLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-2 text-sm text-muted-foreground">Loading tenant data...</p>
          </div>
        </div>
      )}

      {vdcsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Data</AlertTitle>
          <AlertDescription>
            {(vdcsError as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {!vdcsLoading && vdcs && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              title={getTenantLabel(selectedSite?.platformType)}
              value={siteSummary?.totalVdcs?.toString() || vdcs.length.toString()}
              icon={Server}
              trend="Active"
              trendUp={true}
            />
            <StatCard
              title="Virtual Machines"
              value={siteSummary?.totalVms?.toString() || '0'}
              icon={Activity}
              subtext={`${siteSummary?.runningVms || 0} Running / ${(siteSummary?.totalVms || 0) - (siteSummary?.runningVms || 0)} Stopped`}
            />
            <StatCard
              title="Public IPs"
              value={`${siteSummary?.network?.allocatedIps || 0} / ${siteSummary?.network?.totalIps || 0}`}
              icon={Globe}
              subtext={`${siteSummary?.network?.usedIps || 0} In Use / ${siteSummary?.network?.freeIps || 0} Free`}
              warning={siteSummary && siteSummary.network?.totalIps > 0 && (siteSummary.network?.usedIps / siteSummary.network?.totalIps) > 0.9}
            />
            <StatCard
              title="Storage"
              value={`${toTB(siteSummary?.storage?.used || 0)} TB`}
              icon={Database}
              subtext={`Used of ${toTB(siteSummary?.storage?.limit || 0)} TB Limit`}
            />
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              Resource Summary
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="border-border/50 bg-card/50">
                <CardContent className="p-5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4">
                    <Cpu className="h-3.5 w-3.5 text-cyan-500" /> vCPU (3:1)
                  </h4>
                  <ResourceBar
                    label="Usage"
                    data={{
                      Used: toVcpu(siteSummary?.cpu?.used || 0),
                      Limit: toVcpu(siteSummary?.cpu?.capacity || 0),
                      Reserved: toVcpu(siteSummary?.cpu?.reserved || 0),
                      Units: 'vCPU',
                      Allocated: toVcpu(siteSummary?.cpu?.allocated || 0)
                    }}
                    color="bg-cyan-500"
                    type="compute"
                  />
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                      <div className="font-mono font-medium text-foreground">{toVcpu(siteSummary?.cpu?.capacity || 0)}</div>
                      <div className="text-muted-foreground">Capacity vCPU</div>
                    </div>
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                      <div className="font-mono font-medium text-cyan-500">{toVcpu(siteSummary?.cpu?.allocated || 0)}</div>
                      <div className="text-muted-foreground">Allocated vCPU</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/50 bg-card/50">
                <CardContent className="p-5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4">
                    <HardDrive className="h-3.5 w-3.5 text-purple-500" /> Memory
                  </h4>
                  <ResourceBar
                    label="Usage"
                    data={{
                      Used: siteSummary?.memory?.used || 0,
                      Limit: siteSummary?.memory?.capacity || 0,
                      Reserved: siteSummary?.memory?.reserved || 0,
                      Units: 'MB',
                      Allocated: siteSummary?.memory?.allocated || 0
                    }}
                    color="bg-purple-500"
                    type="compute"
                  />
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                      <div className="font-mono font-medium text-foreground">{toGB(siteSummary?.memory?.capacity || 0)}</div>
                      <div className="text-muted-foreground">Capacity GB</div>
                    </div>
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                      <div className="font-mono font-medium text-purple-500">{toGB(siteSummary?.memory?.allocated || 0)}</div>
                      <div className="text-muted-foreground">Allocated GB</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Storage - Show each tier separately if available */}
              {siteSummary?.storageTiers && siteSummary.storageTiers.length > 0 ? (
                siteSummary.storageTiers.map((tier, idx) => {
                  const effectiveCapacity = (tier as any).configuredCapacity || tier.capacity || 0;
                  const hasConfigured = !!(tier as any).hasConfiguredCapacity;
                  return (
                    <Card key={tier.name || idx} className="border-border/50 bg-card/50">
                      <CardContent className="p-5">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4">
                          <Database className="h-3.5 w-3.5 text-emerald-500" /> {tier.name}
                          {hasConfigured && <span className="text-emerald-500">*</span>}
                        </h4>
                        <ResourceBar
                          label="Usage"
                          storageData={{
                            used: tier.used || 0,
                            limit: effectiveCapacity,
                            units: 'MB'
                          }}
                          color="bg-emerald-500"
                          type="storage"
                        />
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                            <div className="font-mono font-medium text-foreground">{toTB(effectiveCapacity)}</div>
                            <div className="text-muted-foreground">Capacity TB{hasConfigured && '*'}</div>
                          </div>
                          <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                            <div className="font-mono font-medium text-emerald-500">{toTB(tier.limit || 0)}</div>
                            <div className="text-muted-foreground">Allocated TB</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <Card className="border-border/50 bg-card/50">
                  <CardContent className="p-5">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4">
                      <Database className="h-3.5 w-3.5 text-emerald-500" /> Storage
                    </h4>
                    <ResourceBar
                      label="Usage"
                      storageData={{
                        used: siteSummary?.storage?.used || 0,
                        limit: siteSummary?.storage?.capacity || 0,
                        units: 'MB'
                      }}
                      color="bg-emerald-500"
                      type="storage"
                    />
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                        <div className="font-mono font-medium text-foreground">{toTB(siteSummary?.storage?.capacity || 0)}</div>
                        <div className="text-muted-foreground">Capacity TB</div>
                      </div>
                      <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                        <div className="font-mono font-medium text-emerald-500">{toTB(siteSummary?.storage?.limit || 0)}</div>
                        <div className="text-muted-foreground">Allocated TB</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="border-border/50 bg-card/50">
                <CardContent className="p-5">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2 mb-4">
                    <Globe className="h-3.5 w-3.5 text-orange-500" /> Public IPs
                  </h4>
                  <ResourceBar
                    label="Allocation"
                    ipData={{
                      totalIpCount: siteSummary?.network?.totalIps || 0,
                      usedIpCount: siteSummary?.network?.usedIps || 0,
                      freeIpCount: siteSummary?.network?.freeIps || 0
                    }}
                    color="bg-orange-500"
                    type="network"
                  />
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                      <div className="font-mono font-medium text-foreground">{siteSummary?.network?.totalIps || 0}</div>
                      <div className="text-muted-foreground">Total IPs</div>
                    </div>
                    <div className="rounded-md border border-border/50 bg-muted/30 p-2 text-center">
                      <div className="font-mono font-medium text-orange-500">{siteSummary?.network?.allocatedIps || 0}</div>
                      <div className="text-muted-foreground">Allocated</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              {getTenantLabel(selectedSite?.platformType)}
            </h2>

            {vdcs.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No Tenants Found</AlertTitle>
                <AlertDescription>
                  No tenant allocations were found for this site. Check your permissions and site configuration.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {vdcs.map((vdc, idx) => {
                  const commitLevel = commitLevelMap.get(vdc.id);
                  const hasCommit = !!commitLevel;
                  const isReportingDisabled = commitLevel?.isReportingDisabled || false;
                  const disabledReason = commitLevel?.disabledReason || undefined;
                  return (
                    <motion.div
                      key={vdc.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="h-full relative"
                    >
                      <VDCDetailCard 
                        vdc={vdc} 
                        backupMetrics={getBackupMetricsForOrg(vdc.org?.id, vdc.orgName)}
                        onSetCommit={() => openCommitDialog(vdc)}
                        hasCommit={hasCommit}
                        isReportingDisabled={isReportingDisabled}
                        disabledReason={disabledReason}
                        onToggleReporting={(disabled) => handleToggleReporting(vdc, disabled)}
                      />
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Minimum Commit Level Dialog */}
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Set Minimum Commit Levels</DialogTitle>
            <DialogDescription>
              {editingTenant?.name} - Define the minimum resource commitment for this tenant. These values will be included in exports.
            </DialogDescription>
          </DialogHeader>
          
          {commitForm && (
            <div className="grid gap-4 py-4">
              <div className="border-b pb-4">
                <h4 className="text-sm font-medium mb-3">Customer Information</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="businessId">Business ID</Label>
                    <Input
                      id="businessId"
                      placeholder="e.g., 12345"
                      value={commitForm.businessId || ''}
                      onChange={(e) => setCommitForm({ ...commitForm, businessId: e.target.value })}
                      data-testid="input-business-id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="businessName">Business Name</Label>
                    <Input
                      id="businessName"
                      placeholder="e.g., Acme Corp"
                      value={commitForm.businessName || ''}
                      onChange={(e) => setCommitForm({ ...commitForm, businessName: e.target.value })}
                      data-testid="input-business-name"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vcpuCount">vCPU Count</Label>
                  <Input
                    id="vcpuCount"
                    placeholder="e.g., 10"
                    value={commitForm.vcpuCount || ''}
                    onChange={(e) => setCommitForm({ ...commitForm, vcpuCount: e.target.value })}
                    data-testid="input-vcpu-count"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vcpuSpeed">CPU Speed (GHz)</Label>
                  <Input
                    id="vcpuSpeed"
                    placeholder="e.g., 2.8"
                    value={commitForm.vcpuSpeedGhz || ''}
                    onChange={(e) => setCommitForm({ ...commitForm, vcpuSpeedGhz: e.target.value })}
                    data-testid="input-vcpu-speed"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ramGB">RAM (GB)</Label>
                <Input
                  id="ramGB"
                  placeholder="e.g., 25"
                  value={commitForm.ramGB || ''}
                  onChange={(e) => setCommitForm({ ...commitForm, ramGB: e.target.value })}
                  data-testid="input-ram-gb"
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Storage by Tier (GB)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="storageHps">HPS (High Performance)</Label>
                    <Input
                      id="storageHps"
                      placeholder="e.g., 200"
                      value={commitForm.storageHpsGB || ''}
                      onChange={(e) => setCommitForm({ ...commitForm, storageHpsGB: e.target.value })}
                      data-testid="input-storage-hps"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="storageSps">SPS (Standard Performance)</Label>
                    <Input
                      id="storageSps"
                      placeholder="e.g., 200"
                      value={commitForm.storageSpsGB || ''}
                      onChange={(e) => setCommitForm({ ...commitForm, storageSpsGB: e.target.value })}
                      data-testid="input-storage-sps"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="storageVvol">VVol</Label>
                    <Input
                      id="storageVvol"
                      placeholder="e.g., 0"
                      value={commitForm.storageVvolGB || ''}
                      onChange={(e) => setCommitForm({ ...commitForm, storageVvolGB: e.target.value })}
                      data-testid="input-storage-vvol"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="storageOther">Other</Label>
                    <Input
                      id="storageOther"
                      placeholder="e.g., 0"
                      value={commitForm.storageOtherGB || ''}
                      onChange={(e) => setCommitForm({ ...commitForm, storageOtherGB: e.target.value })}
                      data-testid="input-storage-other"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="allocatedIps">Public IPs</Label>
                <Input
                  id="allocatedIps"
                  placeholder="e.g., 5"
                  value={commitForm.allocatedIps || ''}
                  onChange={(e) => setCommitForm({ ...commitForm, allocatedIps: e.target.value })}
                  data-testid="input-allocated-ips"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  placeholder="Optional notes about this commitment"
                  value={commitForm.notes || ''}
                  onChange={(e) => setCommitForm({ ...commitForm, notes: e.target.value })}
                  data-testid="input-notes"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCommitDialogOpen(false)}
              data-testid="button-cancel-commit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveCommit}
              disabled={saveCommitMutation.isPending}
              data-testid="button-save-commit"
            >
              <Save className="h-4 w-4 mr-2" />
              {saveCommitMutation.isPending ? 'Saving...' : 'Save Commit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

function StatCard({ title, value, icon: Icon, trend, trendUp, subtext, warning }: any) {
  return (
    <Card className={cn("bg-card border-border", warning && "border-amber-500/50 bg-amber-500/5")}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <Icon className={cn("h-4 w-4", warning ? "text-amber-500" : "text-muted-foreground")} />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className={cn("text-2xl font-bold font-mono", warning && "text-amber-500")}>{value}</div>
            {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
          </div>
          {trend && (
            <div className={`text-xs font-medium px-2 py-1 rounded-full ${trendUp ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
              {trend}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
