import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Download, FileSpreadsheet, AlertCircle, Loader2, TrendingUp, Target, AlertTriangle, Database, HardDrive, Calendar } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { 
  fetchSites, 
  exportTenantsCSV,
  fetchHighWaterMark,
  fetchAvailableMonths,
  getPlatformShortName,
  getPlatformColor,
  type Site,
  type HighWaterMarkTenant,
  type AvailableMonth,
} from '@/lib/api';
import { Progress } from '@/components/ui/progress';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function Report() {
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);
  
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);

  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetchSites(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: availableMonths } = useQuery({
    queryKey: ['availableMonths'],
    queryFn: () => fetchAvailableMonths(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: highWaterMarkData, isLoading: reportLoading } = useQuery({
    queryKey: ['highWaterMark', selectedYear, selectedMonth],
    queryFn: () => fetchHighWaterMark(selectedYear, selectedMonth),
    staleTime: 2 * 60 * 1000,
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportTenantsCSV();
      toast.success('Export downloaded successfully');
    } catch (error: any) {
      toast.error(`Export failed: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleMonthChange = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    setSelectedYear(year);
    setSelectedMonth(month);
  };

  const tableData = useMemo(() => {
    if (!highWaterMarkData?.data) return [];
    return highWaterMarkData.data.filter(row => {
      if (platformFilter === 'all') return true;
      return row.platform.toLowerCase() === platformFilter;
    });
  }, [highWaterMarkData, platformFilter]);

  const platforms = sites ? Array.from(new Set(sites.map(s => s.platformType))) : [];

  const calcOverage = (allocated: number, commit: string) => {
    if (!commit) return null;
    const diff = allocated - parseFloat(commit);
    return diff > 0 ? Math.round(diff) : null;
  };

  const overageCount = tableData.reduce((count, row) => {
    const hasOverage = 
      calcOverage(row.vcpu, row.commitVcpu) ||
      calcOverage(row.ramGB, row.commitRamGB) ||
      calcOverage(row.storageHpsGB, row.commitHpsGB) ||
      calcOverage(row.storageSpsGB, row.commitSpsGB) ||
      calcOverage(row.storageVvolGB, row.commitVvolGB) ||
      calcOverage(row.storageOtherGB, row.commitOtherGB) ||
      calcOverage(row.allocatedIps, row.commitIps);
    return hasOverage ? count + 1 : count;
  }, 0);

  if (sitesError) {
    return (
      <DashboardLayout>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to load report data. Please check your configuration.
          </AlertDescription>
        </Alert>
      </DashboardLayout>
    );
  }

  const TenantInfo = ({ row }: { row: any }) => (
    <>
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span>{row.businessName || row.tenant}</span>
          <span className="text-xs text-muted-foreground font-mono">{row.businessId || row.tenantId}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm">{row.site}</span>
          <span className="text-xs text-muted-foreground">{row.siteLocation}</span>
        </div>
      </TableCell>
      <TableCell>
        <Badge 
          variant="outline" 
          className="text-xs"
          style={{ 
            borderColor: getPlatformColor(row.platform.toLowerCase()),
            color: getPlatformColor(row.platform.toLowerCase()),
          }}
        >
          {row.platform}
        </Badge>
      </TableCell>
    </>
  );

  return (
    <DashboardLayout>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Tenant Billing Report</h1>
          <p className="text-muted-foreground mt-1">
            High water mark usage for billing - shows maximum resource consumption during the selected month.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select 
            value={`${selectedYear}-${selectedMonth}`} 
            onValueChange={handleMonthChange}
          >
            <SelectTrigger className="w-[180px]" data-testid="select-month">
              <Calendar className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent>
              {availableMonths && availableMonths.length > 0 ? (
                availableMonths.map(m => (
                  <SelectItem key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                    {MONTH_NAMES[m.month - 1]} {m.year}
                  </SelectItem>
                ))
              ) : (
                <SelectItem value={`${selectedYear}-${selectedMonth}`}>
                  {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-platform-filter">
              <SelectValue placeholder="All Platforms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              {platforms.map(p => (
                <SelectItem key={p} value={p}>{getPlatformShortName(p)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button 
            onClick={handleExport} 
            disabled={isExporting}
            data-testid="button-export-csv"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {(sitesLoading || reportLoading) ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-2 text-sm text-muted-foreground">Loading report data...</p>
          </div>
        </div>
      ) : (!availableMonths || availableMonths.length === 0) ? (
        <Card>
          <CardContent className="pt-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No Historical Data Available</AlertTitle>
              <AlertDescription>
                The system polls resource usage every 4 hours. Billing data will be available after the first polling cycle completes.
                Check back in a few hours or trigger a manual poll from the dashboard.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ) : tableData.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No Data for Selected Month</AlertTitle>
              <AlertDescription>
                No usage data was recorded for {MONTH_NAMES[selectedMonth - 1]} {selectedYear}. 
                Try selecting a different month from the dropdown.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="allocations" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="allocations" className="flex items-center gap-2" data-testid="tab-allocations">
              <TrendingUp className="h-4 w-4" />
              Allocations
            </TabsTrigger>
            <TabsTrigger value="commits" className="flex items-center gap-2" data-testid="tab-commits">
              <Target className="h-4 w-4" />
              Commits
            </TabsTrigger>
            <TabsTrigger value="overages" className="flex items-center gap-2" data-testid="tab-overages">
              <AlertTriangle className="h-4 w-4" />
              Overages
              {overageCount > 0 && (
                <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-xs">
                  {overageCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="allocations">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  High Water Mark Usage - {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Maximum resource usage recorded during the billing period ({highWaterMarkData?.data?.length || 0} tenants, based on {tableData.reduce((sum, r) => sum + (r.snapshotCount || 0), 0)} polling snapshots)
                </p>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">vCPU</TableHead>
                      <TableHead className="text-right">RAM (GB)</TableHead>
                      <TableHead className="text-right">HPS (GB)</TableHead>
                      <TableHead className="text-right">SPS (GB)</TableHead>
                      <TableHead className="text-right">VVol (GB)</TableHead>
                      <TableHead className="text-right">Other (GB)</TableHead>
                      <TableHead className="text-right">IPs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map((row, idx) => (
                      <TableRow key={idx} data-testid={`row-alloc-${idx}`}>
                        <TenantInfo row={row} />
                        <TableCell className="text-right font-mono">{row.vcpu}</TableCell>
                        <TableCell className="text-right font-mono">{row.ramGB}</TableCell>
                        <TableCell className="text-right font-mono">{row.storageHpsGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono">{row.storageSpsGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono">{row.storageVvolGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono">{row.storageOtherGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono">{row.allocatedIps}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commits">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-600">
                  <Target className="h-5 w-5" />
                  Minimum Commit Levels
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">vCPU</TableHead>
                      <TableHead className="text-right">RAM (GB)</TableHead>
                      <TableHead className="text-right">HPS (GB)</TableHead>
                      <TableHead className="text-right">SPS (GB)</TableHead>
                      <TableHead className="text-right">VVol (GB)</TableHead>
                      <TableHead className="text-right">Other (GB)</TableHead>
                      <TableHead className="text-right">IPs</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map((row, idx) => (
                      <TableRow key={idx} data-testid={`row-commit-${idx}`}>
                        <TenantInfo row={row} />
                        <TableCell className="text-right font-mono text-green-600">{row.commitVcpu || '-'}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{row.commitRamGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{row.commitHpsGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{row.commitSpsGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{row.commitVvolGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{row.commitOtherGB || '-'}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{row.commitIps || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {row.notes || '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="overages">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  Overages (Allocation - Commit)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Platform</TableHead>
                      <TableHead className="text-right">vCPU</TableHead>
                      <TableHead className="text-right">RAM (GB)</TableHead>
                      <TableHead className="text-right">HPS (GB)</TableHead>
                      <TableHead className="text-right">SPS (GB)</TableHead>
                      <TableHead className="text-right">VVol (GB)</TableHead>
                      <TableHead className="text-right">Other (GB)</TableHead>
                      <TableHead className="text-right">IPs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableData.map((row, idx) => {
                      const overVcpu = calcOverage(row.vcpu, row.commitVcpu);
                      const overRam = calcOverage(row.ramGB, row.commitRamGB);
                      const overHps = calcOverage(row.storageHpsGB, row.commitHpsGB);
                      const overSps = calcOverage(row.storageSpsGB, row.commitSpsGB);
                      const overVvol = calcOverage(row.storageVvolGB, row.commitVvolGB);
                      const overOther = calcOverage(row.storageOtherGB, row.commitOtherGB);
                      const overIps = calcOverage(row.allocatedIps, row.commitIps);
                      
                      return (
                        <TableRow key={idx} data-testid={`row-overage-${idx}`}>
                          <TenantInfo row={row} />
                          <TableCell className={`text-right font-mono ${overVcpu ? 'text-red-600 font-bold' : ''}`}>
                            {overVcpu ?? '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${overRam ? 'text-red-600 font-bold' : ''}`}>
                            {overRam ?? '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${overHps ? 'text-red-600 font-bold' : ''}`}>
                            {overHps ?? '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${overSps ? 'text-red-600 font-bold' : ''}`}>
                            {overSps ?? '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${overVvol ? 'text-red-600 font-bold' : ''}`}>
                            {overVvol ?? '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${overOther ? 'text-red-600 font-bold' : ''}`}>
                            {overOther ?? '-'}
                          </TableCell>
                          <TableCell className={`text-right font-mono ${overIps ? 'text-red-600 font-bold' : ''}`}>
                            {overIps ?? '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <div className="mt-4 text-sm text-muted-foreground">
        <p>* vCPU is calculated from allocated MHz assuming 2.8 GHz per core.</p>
      </div>
    </DashboardLayout>
  );
}
