import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { VDCDetailCard } from '@/components/dashboard/VDCDetailCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, Server, Database, Globe, Network, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { fetchSites, fetchSiteVdcs, type Site, type OrgVdc } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function Dashboard() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');

  // Fetch sites
  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Set initial site when sites load
  useEffect(() => {
    if (sites && sites.length > 0 && !selectedSiteId) {
      setSelectedSiteId(sites[0].id);
    }
  }, [sites, selectedSiteId]);

  // Fetch VDCs for selected site
  const { data: vdcs, isLoading: vdcsLoading, error: vdcsError } = useQuery({
    queryKey: ['vdcs', selectedSiteId],
    queryFn: () => fetchSiteVdcs(selectedSiteId),
    enabled: !!selectedSiteId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    refetchInterval: 60 * 1000, // Auto-refresh every minute
  });

  const selectedSite = sites?.find(s => s.id === selectedSiteId);

  // Calculate site-wide stats (with safe access for optional fields)
  const siteStats = (vdcs || []).reduce((acc, vdc) => ({
    totalCpuUsed: acc.totalCpuUsed + (vdc.computeCapacity?.cpu?.used || 0),
    totalCpuLimit: acc.totalCpuLimit + (vdc.computeCapacity?.cpu?.limit || 0),
    totalMemUsed: acc.totalMemUsed + (vdc.computeCapacity?.memory?.used || 0),
    totalMemLimit: acc.totalMemLimit + (vdc.computeCapacity?.memory?.limit || 0),
    totalStorageUsed: acc.totalStorageUsed + (vdc.storageProfiles || []).reduce((s: number, p: any) => s + (p.used || 0), 0),
    totalStorageLimit: acc.totalStorageLimit + (vdc.storageProfiles || []).reduce((s: number, p: any) => s + (p.limit || 0), 0),
    totalIpsUsed: acc.totalIpsUsed + (vdc.network?.allocatedIps?.usedIpCount || 0),
    totalIpsLimit: acc.totalIpsLimit + (vdc.network?.allocatedIps?.totalIpCount || 0),
    vdcCount: acc.vdcCount + 1
  }), {
    totalCpuUsed: 0, totalCpuLimit: 0,
    totalMemUsed: 0, totalMemLimit: 0,
    totalStorageUsed: 0, totalStorageLimit: 0,
    totalIpsUsed: 0, totalIpsLimit: 0,
    vdcCount: 0
  });

  // Helpers for display
  const toGHz = (mhz: number) => (mhz / 1000).toFixed(0);
  const toGB = (mb: number) => (mb / 1024).toFixed(0);
  const toTB = (mb: number) => (mb / 1024 / 1024).toFixed(1);

  // Error display
  if (sitesError) {
    return (
      <DashboardLayout>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to connect to VMware Cloud Director. Please check your configuration in the Secrets tab.
            <br />
            <span className="text-xs mt-2 block">Error: {(sitesError as Error).message}</span>
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    );
  }

  // Loading state
  if (sitesLoading || !sites) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="mt-4 text-muted-foreground">Connecting to VCD...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // No sites configured
  if (sites.length === 0) {
    return (
      <DashboardLayout>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No VCD Sites Configured</AlertTitle>
          <AlertDescription>
            Please configure your VMware Cloud Director sites in the Secrets tab.
            <br />
            <span className="text-xs mt-2 block font-mono">Set VCD_SITES and corresponding credentials. See VCD_SETUP.md for details.</span>
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* Site Selector & Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Infrastructure Overview</h1>
          <p className="text-muted-foreground mt-1">Monitor Organization VDCs and resource consumption.</p>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground font-medium">Select Site:</span>
          <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
            <SelectTrigger className="w-[260px] bg-card border-border" data-testid="select-site">
              <SelectValue placeholder="Select a site" />
            </SelectTrigger>
            <SelectContent>
              {sites.map(site => (
                <SelectItem key={site.id} value={site.id} data-testid={`site-option-${site.id}`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${site.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-medium">{site.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{site.location}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* VDCs Loading or Error State */}
      {vdcsLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-2 text-sm text-muted-foreground">Loading VDC data...</p>
          </div>
        </div>
      )}

      {vdcsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading VDC Data</AlertTitle>
          <AlertDescription>
            {(vdcsError as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* VDC Data Display */}
      {!vdcsLoading && vdcs && (
        <>
          {/* High Level Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              title="Org VDCs"
              value={siteStats.vdcCount.toString()}
              icon={Server}
              trend="Active"
              trendUp={true}
            />
            <StatCard
              title="CPU Allocation"
              value={`${Math.round((siteStats.totalCpuUsed / (siteStats.totalCpuLimit || 1)) * 100)}%`}
              icon={Activity}
              subtext={`${toGHz(siteStats.totalCpuUsed)} / ${toGHz(siteStats.totalCpuLimit)} GHz`}
            />
            <StatCard
              title="Public IP Usage"
              value={`${siteStats.totalIpsUsed} / ${siteStats.totalIpsLimit}`}
              icon={Globe}
              subtext={`${siteStats.totalIpsLimit - siteStats.totalIpsUsed} Available`}
              warning={siteStats.totalIpsUsed / siteStats.totalIpsLimit > 0.9}
            />
            <Card className="bg-card border-border relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Storage Used</h3>
                  <Database className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="text-2xl font-bold font-mono">{toTB(siteStats.totalStorageUsed)} TB</div>
                <p className="text-xs text-muted-foreground mt-1">of {toTB(siteStats.totalStorageLimit)} TB Total Capacity</p>
              </CardContent>
            </Card>
          </div>

          {/* VDC Grid */}
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              Organization VDCs
            </h2>

            {vdcs.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No VDCs Found</AlertTitle>
                <AlertDescription>
                  No Organization VDCs were found for this site. Check your permissions and site configuration.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {vdcs.map((vdc, idx) => (
                  <motion.div
                    key={vdc.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className="h-full"
                  >
                    <VDCDetailCard vdc={vdc} />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
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
