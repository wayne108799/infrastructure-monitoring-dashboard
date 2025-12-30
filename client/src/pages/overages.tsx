import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Loader2, TrendingUp, AlertTriangle, Clock, Filter } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { fetchSites, type Site } from '@/lib/api';

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

  const cpuChartData = useMemo(() => {
    if (!overageData) return [];
    
    const byTime = new Map<string, any>();
    
    overageData.forEach(d => {
      const time = format(new Date(d.polledAt), 'MMM dd HH:mm');
      if (!byTime.has(time)) {
        byTime.set(time, { time, tenants: {} });
      }
      const entry = byTime.get(time)!;
      
      const usedGHz = Math.round(d.cpuUsedMHz / 1000 * 10) / 10;
      const commitGHz = d.commitCpuMHz > 0 ? Math.round(d.commitCpuMHz / 1000 * 10) / 10 : null;
      
      entry.tenants[`${d.tenantId}_used`] = usedGHz;
      if (commitGHz !== null) {
        entry.tenants[`${d.tenantId}_commit`] = commitGHz;
      }
    });
    
    return Array.from(byTime.values()).map(e => ({
      time: e.time,
      ...e.tenants
    })).sort((a, b) => a.time.localeCompare(b.time));
  }, [overageData]);

  const ramChartData = useMemo(() => {
    if (!overageData) return [];
    
    const byTime = new Map<string, any>();
    
    overageData.forEach(d => {
      const time = format(new Date(d.polledAt), 'MMM dd HH:mm');
      if (!byTime.has(time)) {
        byTime.set(time, { time, tenants: {} });
      }
      const entry = byTime.get(time)!;
      
      const usedGB = Math.round(d.ramUsedMB / 1024);
      const commitGB = d.commitRamMB > 0 ? Math.round(d.commitRamMB / 1024) : null;
      
      entry.tenants[`${d.tenantId}_used`] = usedGB;
      if (commitGB !== null) {
        entry.tenants[`${d.tenantId}_commit`] = commitGB;
      }
    });
    
    return Array.from(byTime.values()).map(e => ({
      time: e.time,
      ...e.tenants
    })).sort((a, b) => a.time.localeCompare(b.time));
  }, [overageData]);

  const overageSummary = useMemo(() => {
    if (!overageData) return { cpu: 0, ram: 0, tenantsInOverage: new Set<string>() };
    
    let cpuOverageCount = 0;
    let ramOverageCount = 0;
    const tenantsInOverage = new Set<string>();
    
    overageData.forEach(d => {
      if (d.cpuOverageMHz > 0) {
        cpuOverageCount++;
        tenantsInOverage.add(d.tenantId);
      }
      if (d.ramOverageMB > 0) {
        ramOverageCount++;
        tenantsInOverage.add(d.tenantId);
      }
    });
    
    return { cpu: cpuOverageCount, ram: ramOverageCount, tenantsInOverage };
  }, [overageData]);

  const tenantColors = useMemo(() => {
    const colors = [
      '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', 
      '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
    ];
    const colorMap = new Map<string, { color: string; name: string }>();
    tenants.forEach((t, i) => {
      colorMap.set(t.id, { color: colors[i % colors.length], name: t.name });
    });
    return colorMap;
  }, [tenants]);

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
                <SelectItem value="all">All Tenants</SelectItem>
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
              <CardTitle className="text-sm font-medium">Overage Instances</CardTitle>
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-overage-count">
                {overageSummary.tenantsInOverage.size}
              </div>
              <p className="text-xs text-muted-foreground">
                Tenants with overages in period
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">CPU Overages</CardTitle>
              <TrendingUp className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-cpu-overage-count">
                {overageSummary.cpu}
              </div>
              <p className="text-xs text-muted-foreground">
                Data points above commit
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">RAM Overages</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-ram-overage-count">
                {overageSummary.ram}
              </div>
              <p className="text-xs text-muted-foreground">
                Data points above commit
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
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  CPU Usage vs Commit (GHz)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cpuChartData}>
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
                      <Legend />
                      {Array.from(tenantColors.entries()).map(([tenantId, { color, name }]) => (
                        <Line
                          key={`${tenantId}_used`}
                          type="monotone"
                          dataKey={`${tenantId}_used`}
                          name={`${name} (Used)`}
                          stroke={color}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                      {Array.from(tenantColors.entries()).map(([tenantId, { color, name }]) => (
                        <Line
                          key={`${tenantId}_commit`}
                          type="monotone"
                          dataKey={`${tenantId}_commit`}
                          name={`${name} (Commit)`}
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Solid lines show used CPU, dashed lines show commit levels. Areas above commit represent overages.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  RAM Usage vs Commit (GB)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ramChartData}>
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
                      <Legend />
                      {Array.from(tenantColors.entries()).map(([tenantId, { color, name }]) => (
                        <Line
                          key={`${tenantId}_used`}
                          type="monotone"
                          dataKey={`${tenantId}_used`}
                          name={`${name} (Used)`}
                          stroke={color}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                      {Array.from(tenantColors.entries()).map(([tenantId, { color, name }]) => (
                        <Line
                          key={`${tenantId}_commit`}
                          type="monotone"
                          dataKey={`${tenantId}_commit`}
                          name={`${name} (Commit)`}
                          stroke={color}
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Solid lines show used RAM, dashed lines show commit levels. Areas above commit represent overages.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Overage Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Array.from(overageSummary.tenantsInOverage).length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No overages detected in the selected time period
                    </div>
                  ) : (
                    Array.from(overageSummary.tenantsInOverage).map(tenantId => {
                      const tenant = tenants.find(t => t.id === tenantId);
                      const tenantData = overageData.filter(d => d.tenantId === tenantId);
                      const cpuOverages = tenantData.filter(d => d.cpuOverageMHz > 0);
                      const ramOverages = tenantData.filter(d => d.ramOverageMB > 0);
                      
                      return (
                        <div key={tenantId} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-medium">{tenant?.name || tenantId}</h4>
                            <div className="flex gap-2">
                              {cpuOverages.length > 0 && (
                                <Badge variant="destructive" data-testid={`badge-cpu-overage-${tenantId}`}>
                                  {cpuOverages.length} CPU overages
                                </Badge>
                              )}
                              {ramOverages.length > 0 && (
                                <Badge variant="destructive" data-testid={`badge-ram-overage-${tenantId}`}>
                                  {ramOverages.length} RAM overages
                                </Badge>
                              )}
                            </div>
                          </div>
                          {cpuOverages.length > 0 && (
                            <p className="text-sm text-muted-foreground">
                              Max CPU overage: {(Math.max(...cpuOverages.map(d => d.cpuOverageMHz)) / 1000).toFixed(1)} GHz
                            </p>
                          )}
                          {ramOverages.length > 0 && (
                            <p className="text-sm text-muted-foreground">
                              Max RAM overage: {Math.round(Math.max(...ramOverages.map(d => d.ramOverageMB)) / 1024)} GB
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
