import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { VDCDetailCard } from '@/components/dashboard/VDCDetailCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, Server, Database, Globe, Network, AlertCircle, Cpu, HardDrive } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { fetchSites, fetchSiteVdcs, fetchSiteSummary, type Site, type OrgVdc, type SiteSummary } from '@/lib/api';
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

  // Fetch site summary for totals
  const { data: siteSummary } = useQuery({
    queryKey: ['siteSummary', selectedSiteId],
    queryFn: () => fetchSiteSummary(selectedSiteId),
    enabled: !!selectedSiteId,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const selectedSite = sites?.find(s => s.id === selectedSiteId);

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
          {/* Summary Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard
              title="Organization VDCs"
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

          {/* Detailed Resource Summary Table */}
          <Card className="mb-8 border-border/50">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                Resource Summary
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Resource</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Capacity</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Allocated</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Reserved</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Used</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-3 px-4 font-medium flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-cyan-500" /> CPU
                      </td>
                      <td className="text-right py-3 px-4 font-mono text-slate-400">{toGHz(siteSummary?.cpu?.capacity || 0)} GHz</td>
                      <td className="text-right py-3 px-4 font-mono">{toGHz(siteSummary?.cpu?.allocated || 0)} GHz</td>
                      <td className="text-right py-3 px-4 font-mono text-amber-500">{toGHz(siteSummary?.cpu?.reserved || 0)} GHz</td>
                      <td className="text-right py-3 px-4 font-mono text-blue-500">{toGHz(siteSummary?.cpu?.used || 0)} GHz</td>
                      <td className="text-right py-3 px-4 font-mono text-green-500">{toGHz(siteSummary?.cpu?.available || 0)} GHz</td>
                    </tr>
                    <tr className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-3 px-4 font-medium flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-purple-500" /> Memory
                      </td>
                      <td className="text-right py-3 px-4 font-mono text-slate-400">{toGB(siteSummary?.memory?.capacity || 0)} GB</td>
                      <td className="text-right py-3 px-4 font-mono">{toGB(siteSummary?.memory?.allocated || 0)} GB</td>
                      <td className="text-right py-3 px-4 font-mono text-amber-500">{toGB(siteSummary?.memory?.reserved || 0)} GB</td>
                      <td className="text-right py-3 px-4 font-mono text-blue-500">{toGB(siteSummary?.memory?.used || 0)} GB</td>
                      <td className="text-right py-3 px-4 font-mono text-green-500">{toGB(siteSummary?.memory?.available || 0)} GB</td>
                    </tr>
                    <tr className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-3 px-4 font-medium flex items-center gap-2">
                        <Database className="h-4 w-4 text-emerald-500" /> Storage
                      </td>
                      <td className="text-right py-3 px-4 font-mono text-slate-400">{toTB(siteSummary?.storage?.capacity || 0)} TB</td>
                      <td className="text-right py-3 px-4 font-mono">{toTB(siteSummary?.storage?.limit || 0)} TB</td>
                      <td className="text-right py-3 px-4 font-mono text-muted-foreground">-</td>
                      <td className="text-right py-3 px-4 font-mono text-blue-500">{toTB(siteSummary?.storage?.used || 0)} TB</td>
                      <td className="text-right py-3 px-4 font-mono text-green-500">{toTB(siteSummary?.storage?.available || 0)} TB</td>
                    </tr>
                    <tr className="hover:bg-muted/30">
                      <td className="py-3 px-4 font-medium flex items-center gap-2">
                        <Globe className="h-4 w-4 text-orange-500" /> Public IPs
                      </td>
                      <td className="text-right py-3 px-4 font-mono text-slate-400">{siteSummary?.network?.totalIps || 0}</td>
                      <td className="text-right py-3 px-4 font-mono">{siteSummary?.network?.allocatedIps || 0}</td>
                      <td className="text-right py-3 px-4 font-mono text-muted-foreground">-</td>
                      <td className="text-right py-3 px-4 font-mono text-blue-500">{siteSummary?.network?.usedIps || 0}</td>
                      <td className="text-right py-3 px-4 font-mono text-green-500">{siteSummary?.network?.freeIps || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

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
