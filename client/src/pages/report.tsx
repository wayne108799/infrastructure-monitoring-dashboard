import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, FileSpreadsheet, AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { toast } from 'sonner';
import { 
  fetchSites, 
  fetchCommitLevels,
  exportTenantsCSV,
  getPlatformShortName,
  getPlatformColor,
  type Site,
  type TenantCommitLevel
} from '@/lib/api';

interface ReportRow {
  site: string;
  siteLocation: string;
  platform: string;
  tenant: string;
  vcpu: number;
  ramGB: number;
  storageHpsGB: number;
  storageSpsGB: number;
  storageVvolGB: number;
  storageOtherGB: number;
  allocatedIps: number;
  commitVcpu: string;
  commitGhz: string;
  commitRamGB: string;
  commitHpsGB: string;
  commitSpsGB: string;
  commitVvolGB: string;
  commitOtherGB: string;
  commitIps: string;
  notes: string;
}

export default function Report() {
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [isExporting, setIsExporting] = useState(false);

  const { data: sites, isLoading: sitesLoading, error: sitesError } = useQuery({
    queryKey: ['sites'],
    queryFn: () => fetchSites(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: commitLevels } = useQuery({
    queryKey: ['commitLevels'],
    queryFn: () => fetchCommitLevels(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: reportData, isLoading: reportLoading } = useQuery({
    queryKey: ['reportData'],
    queryFn: async () => {
      const response = await fetch('/api/export/tenants?format=json');
      if (!response.ok) throw new Error('Failed to fetch report data');
      return response.json() as Promise<any[]>;
    },
    staleTime: 2 * 60 * 1000,
  });

  const commitLevelMap = new Map<string, TenantCommitLevel>();
  if (commitLevels) {
    for (const level of commitLevels) {
      commitLevelMap.set(`${level.siteId}:${level.tenantName}`, level);
    }
  }

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

  const filteredData = reportData?.filter(row => {
    if (platformFilter === 'all') return true;
    return row.platform.toLowerCase() === platformFilter;
  });

  const uniqueTenants = new Map<string, any>();
  if (filteredData) {
    for (const row of filteredData) {
      const key = `${row.site}:${row.tenant}`;
      if (!uniqueTenants.has(key)) {
        uniqueTenants.set(key, {
          site: row.site,
          siteLocation: row.siteLocation,
          platform: row.platform,
          tenant: row.tenant,
          vcpu: Math.round(row.cpuAllocatedMHz / 2800),
          ramGB: Math.round(row.ramAllocatedMB / 1024),
          storageHpsGB: 0,
          storageSpsGB: 0,
          storageVvolGB: 0,
          storageOtherGB: 0,
          allocatedIps: row.allocatedIps,
          commitVcpu: row.commitVcpu || '',
          commitGhz: row.commitGhz || '',
          commitRamGB: row.commitRamGB || '',
          commitHpsGB: row.commitHpsGB || '',
          commitSpsGB: row.commitSpsGB || '',
          commitVvolGB: row.commitVvolGB || '',
          commitOtherGB: row.commitOtherGB || '',
          commitIps: row.commitIps || '',
          notes: row.commitNotes || '',
        });
      }
      const existing = uniqueTenants.get(key);
      const tierName = row.storageTier?.toLowerCase() || '';
      const tierGB = Math.round(row.tierLimitMB / 1024);
      if (tierName.includes('hps') || tierName.includes('high')) {
        existing.storageHpsGB += tierGB;
      } else if (tierName.includes('sps') || tierName.includes('standard')) {
        existing.storageSpsGB += tierGB;
      } else if (tierName.includes('vvol')) {
        existing.storageVvolGB += tierGB;
      } else {
        existing.storageOtherGB += tierGB;
      }
    }
  }

  const tableData = Array.from(uniqueTenants.values());

  const platforms = sites ? Array.from(new Set(sites.map(s => s.platformType))) : [];

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

  return (
    <DashboardLayout>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Tenant Report</h1>
          <p className="text-muted-foreground mt-1">Resource allocation and commit levels by customer.</p>
        </div>
        <div className="flex items-center gap-4">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Customer Resource Allocation
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(sitesLoading || reportLoading) ? (
            <div className="flex items-center justify-center h-48">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="mt-2 text-sm text-muted-foreground">Loading report data...</p>
              </div>
            </div>
          ) : tableData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No tenant data available
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background">Customer</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">vCPU</TableHead>
                    <TableHead className="text-right">RAM (GB)</TableHead>
                    <TableHead className="text-right">HPS (GB)</TableHead>
                    <TableHead className="text-right">SPS (GB)</TableHead>
                    <TableHead className="text-right">VVol (GB)</TableHead>
                    <TableHead className="text-right">Other (GB)</TableHead>
                    <TableHead className="text-right">IPs</TableHead>
                    <TableHead className="border-l text-right">Commit vCPU</TableHead>
                    <TableHead className="text-right">Commit RAM</TableHead>
                    <TableHead className="text-right">Commit HPS</TableHead>
                    <TableHead className="text-right">Commit SPS</TableHead>
                    <TableHead className="text-right">Commit VVol</TableHead>
                    <TableHead className="text-right">Commit Other</TableHead>
                    <TableHead className="text-right">Commit IPs</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((row, idx) => (
                    <TableRow key={idx} data-testid={`row-tenant-${idx}`}>
                      <TableCell className="sticky left-0 bg-background font-medium">
                        {row.tenant}
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
                      <TableCell className="text-right font-mono">{row.vcpu}</TableCell>
                      <TableCell className="text-right font-mono">{row.ramGB}</TableCell>
                      <TableCell className="text-right font-mono">{row.storageHpsGB || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{row.storageSpsGB || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{row.storageVvolGB || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{row.storageOtherGB || '-'}</TableCell>
                      <TableCell className="text-right font-mono">{row.allocatedIps}</TableCell>
                      <TableCell className="border-l text-right font-mono text-green-600">
                        {row.commitVcpu || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {row.commitRamGB || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {row.commitHpsGB || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {row.commitSpsGB || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {row.commitVvolGB || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {row.commitOtherGB || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-green-600">
                        {row.commitIps || '-'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {row.notes || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 text-sm text-muted-foreground">
        <p>* vCPU is calculated from allocated MHz assuming 2.8 GHz per core. Commit levels are shown in green.</p>
      </div>
    </DashboardLayout>
  );
}
