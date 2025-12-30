import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Loader2, TrendingUp, AlertTriangle, Clock, Filter, Cpu, HardDrive } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  AreaChart, 
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { fetchSites } from '@/lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';

interface OverageDataPoint {
  id: string;
  siteId: string;
  tenantId: string;
  orgName: string;
  orgFullName: string;
  polledAt: string;
  vmCount: number;
  runningVmCount: number;
  cpuUsedMHz: number;
  cpuAllocatedMHz: number;
  ramUsedMB: number;
  ramAllocatedMB: number;
  storageUsedMB: number;
  storageTiers: any[];
  allocatedIps: number;
  commitCpuMHz: number;
  commitRamMB: number;
  commitStorageHpsMB: number;
  commitStorageSpsMB: number;
  commitStorageVvolMB: number;
  cpuOverageMHz: number;
  ramOverageMB: number;
  hasCommit: boolean;
}

async function fetchOverageData(options: {
  startDate?: string;
  endDate?: string;
  siteId?: string;
  tenantId?: string;
}): Promise<OverageDataPoint[]> {
  const params = new URLSearchParams();
  if (options.startDate) params.append('startDate', options.startDate);
  if (options.endDate) params.append('endDate', options.endDate);
  if (options.siteId) params.append('siteId', options.siteId);
  if (options.tenantId) params.append('tenantId', options.tenantId);
  
  const response = await fetch(`/api/report/overages?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Failed to fetch overage data');
  }
  return response.json();
}

export default function Overages() {
  const [dateRange, setDateRange] = useState<string>('7');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('all');
  const [selectedTenantId, setSelectedTenantId] = useState<string>('all');

  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetchSites(),
    staleTime: 5 * 60 * 1000,
  });

  const startDate = useMemo(() => {
    return startOfDay(subDays(new Date(), parseInt(dateRange))).toISOString();
  }, [dateRange]);

  const endDate = useMemo(() => {
    return endOfDay(new Date()).toISOString();
  }, []);

  const { data: overageData, isLoading, error } = useQuery({
    queryKey: ['overages', startDate, endDate, selectedSiteId, selectedTenantId],
    queryFn: () => fetchOverageData({
      startDate,
      endDate,
      siteId: selectedSiteId === 'all' ? undefined : selectedSiteId,
      tenantId: selectedTenantId === 'all' ? undefined : selectedTenantId,
    }),
    staleTime: 2 * 60 * 1000,
  });

  const tenants = useMemo(() => {
    if (!overageData) return [];
    const tenantMap = new Map<string, { id: string; name: string; siteId: string }>();
    overageData.forEach(d => {
      if (!tenantMap.has(d.tenantId)) {
        tenantMap.set(d.tenantId, {
          id: d.tenantId,
          name: d.orgFullName || d.orgName,
          siteId: d.siteId
        });
      }
    });
    return Array.from(tenantMap.values());
  }, [overageData]);

  const filteredTenants = useMemo(() => {
    if (selectedSiteId === 'all') return tenants;
    return tenants.filter(t => t.siteId === selectedSiteId);
  }, [tenants, selectedSiteId]);

  const tenantSummaries = useMemo(() => {
    if (!overageData) return [];
    
    const summaryMap = new Map<string, {
      tenantId: string;
      tenantName: string;
      siteId: string;
      maxCpuUsedGHz: number;
      commitCpuGHz: number;
      maxRamUsedGB: number;
      commitRamGB: number;
      cpuOverageCount: number;
      ramOverageCount: number;
      maxCpuOverageGHz: number;
      maxRamOverageGB: number;
      hasCommit: boolean;
      dataPoints: number;
    }>();

    overageData.forEach(d => {
      if (!summaryMap.has(d.tenantId)) {
        summaryMap.set(d.tenantId, {
          tenantId: d.tenantId,
          tenantName: d.orgFullName || d.orgName,
          siteId: d.siteId,
          maxCpuUsedGHz: 0,
          commitCpuGHz: d.commitCpuMHz / 1000,
          maxRamUsedGB: 0,
          commitRamGB: d.commitRamMB / 1024,
          cpuOverageCount: 0,
          ramOverageCount: 0,
          maxCpuOverageGHz: 0,
          maxRamOverageGB: 0,
          hasCommit: d.hasCommit,
          dataPoints: 0,
        });
      }
      
      const summary = summaryMap.get(d.tenantId)!;
      summary.dataPoints++;
      
      const cpuGHz = d.cpuUsedMHz / 1000;
      const ramGB = d.ramUsedMB / 1024;
      
      if (cpuGHz > summary.maxCpuUsedGHz) summary.maxCpuUsedGHz = cpuGHz;
      if (ramGB > summary.maxRamUsedGB) summary.maxRamUsedGB = ramGB;
      
      if (d.cpuOverageMHz > 0) {
        summary.cpuOverageCount++;
        const overageGHz = d.cpuOverageMHz / 1000;
        if (overageGHz > summary.maxCpuOverageGHz) summary.maxCpuOverageGHz = overageGHz;
      }
      
      if (d.ramOverageMB > 0) {
        summary.ramOverageCount++;
        const overageGB = d.ramOverageMB / 1024;
        if (overageGB > summary.maxRamOverageGB) summary.maxRamOverageGB = overageGB;
      }
    });

    return Array.from(summaryMap.values())
      .sort((a, b) => (b.cpuOverageCount + b.ramOverageCount) - (a.cpuOverageCount + a.ramOverageCount));
  }, [overageData]);

  const selectedTenantData = useMemo(() => {
    if (selectedTenantId === 'all' || !overageData) return null;
    
    const tenantData = overageData
      .filter(d => d.tenantId === selectedTenantId)
      .sort((a, b) => new Date(a.polledAt).getTime() - new Date(b.polledAt).getTime());
    
    if (tenantData.length === 0) return null;
    
    const commitCpuGHz = tenantData[0].commitCpuMHz / 1000;
    const commitRamGB = tenantData[0].commitRamMB / 1024;
    
    const chartData = tenantData.map(d => ({
      time: format(new Date(d.polledAt), 'MMM dd HH:mm'),
      cpuUsed: Math.round(d.cpuUsedMHz / 100) / 10,
      cpuCommit: commitCpuGHz,
      cpuOverage: d.cpuOverageMHz > 0 ? Math.round(d.cpuOverageMHz / 100) / 10 : 0,
      ramUsed: Math.round(d.ramUsedMB / 1024 * 10) / 10,
      ramCommit: commitRamGB,
      ramOverage: d.ramOverageMB > 0 ? Math.round(d.ramOverageMB / 1024 * 10) / 10 : 0,
    }));
    
    return {
      tenantName: tenantData[0].orgFullName || tenantData[0].orgName,
      commitCpuGHz,
      commitRamGB,
      hasCommit: tenantData[0].hasCommit,
      chartData,
    };
  }, [overageData, selectedTenantId]);

  const overageSummary = useMemo(() => {
    const tenantsWithOverages = tenantSummaries.filter(t => t.cpuOverageCount > 0 || t.ramOverageCount > 0);
    const totalCpuOverages = tenantSummaries.reduce((sum, t) => sum + t.cpuOverageCount, 0);
    const totalRamOverages = tenantSummaries.reduce((sum, t) => sum + t.ramOverageCount, 0);
    
    return {
      tenantsInOverage: tenantsWithOverages.length,
      totalCpuOverages,
      totalRamOverages,
    };
  }, [tenantSummaries]);

  if (sitesError || error) {
    return (
      <DashboardLayout>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to load overage data. Please check your configuration.
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Overages</h1>
            <p className="text-muted-foreground">
              Track resource usage vs commit levels over time
            </p>
          </div>
          
          <div className="flex flex-wrap gap-2">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[140px]" data-testid="select-date-range">
                <Clock className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Time range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={selectedSiteId} onValueChange={(v) => { setSelectedSiteId(v); setSelectedTenantId('all'); }}>
              <SelectTrigger className="w-[160px]" data-testid="select-site">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by site" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sites</SelectItem>
                {sites?.map(site => (
                  <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
              <SelectTrigger className="w-[180px]" data-testid="select-tenant">
                <SelectValue placeholder="Filter by tenant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tenants (Summary)</SelectItem>
                {filteredTenants.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tenants with Overages</CardTitle>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-overage-count">
                {overageSummary.tenantsInOverage}
              </div>
              <p className="text-xs text-muted-foreground">
                out of {tenantSummaries.length} tenants
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">CPU Overage Events</CardTitle>
              <Cpu className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-cpu-overage-count">
                {overageSummary.totalCpuOverages}
              </div>
              <p className="text-xs text-muted-foreground">
                times usage exceeded commit
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">RAM Overage Events</CardTitle>
              <HardDrive className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-ram-overage-count">
                {overageSummary.totalRamOverages}
              </div>
              <p className="text-xs text-muted-foreground">
                times usage exceeded commit
              </p>
            </CardContent>
          </Card>
        </div>

        {isLoading || sitesLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !overageData || overageData.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Data Available</AlertTitle>
            <AlertDescription>
              No polling data found for the selected time period. Data is collected every 4 hours.
            </AlertDescription>
          </Alert>
        ) : selectedTenantId === 'all' ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5" />
                    CPU: Commit vs Peak Usage (GHz)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={tenantSummaries.filter(t => t.hasCommit).slice(0, 10).map(t => ({
                          name: t.tenantName.length > 15 ? t.tenantName.substring(0, 15) + '...' : t.tenantName,
                          commit: Math.round(t.commitCpuGHz * 10) / 10,
                          used: Math.round(t.maxCpuUsedGHz * 10) / 10,
                          overage: t.maxCpuOverageGHz > 0 ? Math.round(t.maxCpuOverageGHz * 10) / 10 : 0,
                        }))}
                        layout="vertical"
                        margin={{ left: 20, right: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                        <Tooltip />
                        <Bar dataKey="commit" name="Commit" fill="#94a3b8" />
                        <Bar dataKey="used" name="Peak Used" fill="#3b82f6">
                          {tenantSummaries.filter(t => t.hasCommit).slice(0, 10).map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.maxCpuOverageGHz > 0 ? '#ef4444' : '#3b82f6'} 
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Red bars indicate usage exceeded commit. Showing top 10 tenants with commit levels.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <HardDrive className="h-5 w-5" />
                    RAM: Commit vs Peak Usage (GB)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={tenantSummaries.filter(t => t.hasCommit).slice(0, 10).map(t => ({
                          name: t.tenantName.length > 15 ? t.tenantName.substring(0, 15) + '...' : t.tenantName,
                          commit: Math.round(t.commitRamGB),
                          used: Math.round(t.maxRamUsedGB),
                          overage: t.maxRamOverageGB > 0 ? Math.round(t.maxRamOverageGB) : 0,
                        }))}
                        layout="vertical"
                        margin={{ left: 20, right: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                        <Tooltip />
                        <Bar dataKey="commit" name="Commit" fill="#94a3b8" />
                        <Bar dataKey="used" name="Peak Used" fill="#22c55e">
                          {tenantSummaries.filter(t => t.hasCommit).slice(0, 10).map((entry, index) => (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={entry.maxRamOverageGB > 0 ? '#ef4444' : '#22c55e'} 
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    Red bars indicate usage exceeded commit. Showing top 10 tenants with commit levels.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>All Tenant Details</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead className="text-right">CPU Commit</TableHead>
                    <TableHead className="text-right">Max CPU Used</TableHead>
                    <TableHead className="text-right">CPU Overages</TableHead>
                    <TableHead className="text-right">RAM Commit</TableHead>
                    <TableHead className="text-right">Max RAM Used</TableHead>
                    <TableHead className="text-right">RAM Overages</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenantSummaries.map(summary => {
                    const hasCpuOverage = summary.cpuOverageCount > 0;
                    const hasRamOverage = summary.ramOverageCount > 0;
                    
                    return (
                      <TableRow 
                        key={summary.tenantId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedTenantId(summary.tenantId)}
                        data-testid={`row-tenant-${summary.tenantId}`}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {summary.tenantName}
                            {(hasCpuOverage || hasRamOverage) && (
                              <AlertTriangle className="h-4 w-4 text-orange-500" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.hasCommit ? `${summary.commitCpuGHz.toFixed(1)} GHz` : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={hasCpuOverage ? 'text-red-500 font-medium' : ''}>
                            {summary.maxCpuUsedGHz.toFixed(1)} GHz
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {hasCpuOverage ? (
                            <Badge variant="destructive">{summary.cpuOverageCount}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {summary.hasCommit ? `${summary.commitRamGB.toFixed(0)} GB` : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={hasRamOverage ? 'text-red-500 font-medium' : ''}>
                            {summary.maxRamUsedGB.toFixed(0)} GB
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {hasRamOverage ? (
                            <Badge variant="destructive">{summary.ramOverageCount}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground mt-4">
                Click a row to see detailed charts for that tenant.
              </p>
            </CardContent>
          </Card>
          </>
        ) : selectedTenantData ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  CPU Usage - {selectedTenantData.tenantName}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedTenantData.hasCommit ? (
                  <Alert className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No commit level set for this tenant. Set a commit level on the Details page.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedTenantData.chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        label={{ value: 'GHz', angle: -90, position: 'insideLeft' }}
                      />
                      <Tooltip />
                      {selectedTenantData.hasCommit && (
                        <ReferenceLine 
                          y={selectedTenantData.commitCpuGHz} 
                          stroke="#ef4444" 
                          strokeDasharray="5 5"
                          label={{ value: `Commit: ${selectedTenantData.commitCpuGHz.toFixed(1)} GHz`, position: 'right', fill: '#ef4444', fontSize: 11 }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="cpuUsed"
                        name="CPU Used (GHz)"
                        stroke="#3b82f6"
                        fill="#3b82f6"
                        fillOpacity={0.3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-5 w-5" />
                  RAM Usage - {selectedTenantData.tenantName}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={selectedTenantData.chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="time" 
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        label={{ value: 'GB', angle: -90, position: 'insideLeft' }}
                      />
                      <Tooltip />
                      {selectedTenantData.hasCommit && (
                        <ReferenceLine 
                          y={selectedTenantData.commitRamGB} 
                          stroke="#ef4444" 
                          strokeDasharray="5 5"
                          label={{ value: `Commit: ${selectedTenantData.commitRamGB.toFixed(0)} GB`, position: 'right', fill: '#ef4444', fontSize: 11 }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="ramUsed"
                        name="RAM Used (GB)"
                        stroke="#22c55e"
                        fill="#22c55e"
                        fillOpacity={0.3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Data</AlertTitle>
            <AlertDescription>
              No data available for the selected tenant.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </DashboardLayout>
  );
}
