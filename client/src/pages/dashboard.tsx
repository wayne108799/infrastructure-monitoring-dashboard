import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Cpu, HardDrive, Database, Globe, Server, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchSites, fetchSiteSummary, type Site, type SiteSummary } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell
} from 'recharts';

interface SiteData {
  site: Site;
  summary: SiteSummary | null;
}

export default function Dashboard() {
  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery({
    queryKey: ['sites'],
    queryFn: fetchSites,
    staleTime: 5 * 60 * 1000,
  });

  const { data: allSiteSummaries, isLoading: summariesLoading } = useQuery({
    queryKey: ['allSiteSummaries', sites?.map(s => s.id)],
    queryFn: async () => {
      if (!sites) return [];
      const summaries = await Promise.all(
        sites.map(async (site) => {
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
    enabled: !!sites && sites.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
  });

  const toGHz = (mhz: number) => (mhz / 1000).toFixed(0);
  const toGB = (mb: number) => (mb / 1024).toFixed(0);
  const toTB = (mb: number) => (mb / 1024 / 1024).toFixed(1);

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

  if (sites.length === 0) {
    return (
      <DashboardLayout>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>No VCD Sites Configured</AlertTitle>
          <AlertDescription>
            Please configure your VMware Cloud Director sites in the Secrets tab.
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    );
  }

  const cpuData = allSiteSummaries?.map(({ site, summary }) => ({
    name: site.name,
    Capacity: summary ? Math.round(summary.cpu.capacity / 1000) : 0,
    Allocated: summary ? Math.round(summary.cpu.allocated / 1000) : 0,
    Used: summary ? Math.round(summary.cpu.used / 1000) : 0,
  })) || [];

  const memoryData = allSiteSummaries?.map(({ site, summary }) => ({
    name: site.name,
    Capacity: summary ? Math.round(summary.memory.capacity / 1024) : 0,
    Allocated: summary ? Math.round(summary.memory.allocated / 1024) : 0,
    Used: summary ? Math.round(summary.memory.used / 1024) : 0,
  })) || [];

  const storageData = allSiteSummaries?.map(({ site, summary }) => ({
    name: site.name,
    Capacity: summary ? parseFloat((summary.storage.capacity / 1024 / 1024).toFixed(1)) : 0,
    Used: summary ? parseFloat((summary.storage.used / 1024 / 1024).toFixed(1)) : 0,
    Available: summary ? parseFloat((summary.storage.available / 1024 / 1024).toFixed(1)) : 0,
  })) || [];

  const ipData = allSiteSummaries?.map(({ site, summary }) => ({
    name: site.name,
    Total: summary?.network?.totalIps || 0,
    Allocated: summary?.network?.allocatedIps || 0,
    Available: summary?.network?.freeIps || 0,
  })) || [];

  const totalVdcs = allSiteSummaries?.reduce((sum, { summary }) => sum + (summary?.totalVdcs || 0), 0) || 0;
  const totalVms = allSiteSummaries?.reduce((sum, { summary }) => sum + (summary?.totalVms || 0), 0) || 0;
  const runningVms = allSiteSummaries?.reduce((sum, { summary }) => sum + (summary?.runningVms || 0), 0) || 0;

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Infrastructure Overview</h1>
        <p className="text-muted-foreground mt-1">Resource utilization across all VCD sites.</p>
      </div>

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
                <div className="text-3xl font-bold font-mono">{sites.length}</div>
                <p className="text-xs text-muted-foreground mt-1">{totalVdcs} Organization VDCs</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center justify-between pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Virtual Machines</h3>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="text-3xl font-bold font-mono">{totalVms}</div>
                <p className="text-xs text-muted-foreground mt-1">{runningVms} Running / {totalVms - runningVms} Stopped</p>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-6">
                <div className="flex items-center justify-between pb-2">
                  <h3 className="text-sm font-medium text-muted-foreground">Sites Status</h3>
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex gap-4 mt-2">
                  {sites.map(site => (
                    <div key={site.id} className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${site.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-sm font-medium">{site.name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-cyan-500" />
                  CPU (GHz)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cpuData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))'
                        }} 
                      />
                      <Legend />
                      <Bar dataKey="Capacity" fill="#64748b" name="Capacity" />
                      <Bar dataKey="Allocated" fill="#0ea5e9" name="Allocated" />
                      <Bar dataKey="Used" fill="#22c55e" name="Used" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-purple-500" />
                  Memory (GB)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={memoryData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))'
                        }} 
                      />
                      <Legend />
                      <Bar dataKey="Capacity" fill="#64748b" name="Capacity" />
                      <Bar dataKey="Allocated" fill="#a855f7" name="Allocated" />
                      <Bar dataKey="Used" fill="#22c55e" name="Used" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Database className="h-5 w-5 text-emerald-500" />
                  Storage (TB)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={storageData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))'
                        }} 
                      />
                      <Legend />
                      <Bar dataKey="Capacity" fill="#64748b" name="Capacity" />
                      <Bar dataKey="Used" fill="#10b981" name="Used" />
                      <Bar dataKey="Available" fill="#22c55e" name="Available" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Globe className="h-5 w-5 text-orange-500" />
                  Public IPs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ipData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          color: 'hsl(var(--foreground))'
                        }} 
                      />
                      <Legend />
                      <Bar dataKey="Total" fill="#64748b" name="Total" />
                      <Bar dataKey="Allocated" fill="#f97316" name="Allocated" />
                      <Bar dataKey="Available" fill="#22c55e" name="Available" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
