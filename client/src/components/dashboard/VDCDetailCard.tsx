import { ResourceBar } from './ResourceBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Cpu, Database, Globe, Building2, Server, Shield, Settings2, EyeOff, Eye } from 'lucide-react';
import type { OrgVdc, OrgBackupMetrics } from '@/lib/api';

interface VDCDetailCardProps {
  vdc: OrgVdc;
  backupMetrics?: OrgBackupMetrics;
  onSetCommit?: () => void;
  hasCommit?: boolean;
  isReportingDisabled?: boolean;
  disabledReason?: string;
  onToggleReporting?: (disabled: boolean) => void;
}

export function VDCDetailCard({ vdc, backupMetrics, onSetCommit, hasCommit, isReportingDisabled, disabledReason, onToggleReporting }: VDCDetailCardProps) {
  const cpuAllocated = vdc.computeCapacity?.cpu?.allocated || 0;
  const cpuLimit = vdc.computeCapacity?.cpu?.limit || 0;
  const cpuReserved = vdc.computeCapacity?.cpu?.reserved || 0;
  const cpuUsed = vdc.computeCapacity?.cpu?.used || 0;
  
  const memAllocated = vdc.computeCapacity?.memory?.allocated || 0;
  const memLimit = vdc.computeCapacity?.memory?.limit || 0;
  const memReserved = vdc.computeCapacity?.memory?.reserved || 0;
  const memUsed = vdc.computeCapacity?.memory?.used || 0;
  
  const ipAllocation = (vdc as any).ipAllocation || vdc.network?.allocatedIps || {};
  const ipUsed = ipAllocation.usedIpCount || 0;
  const ipTotal = ipAllocation.totalIpCount || 0;
  
  const vmResources = (vdc as any).vmResources || { cpuUsed: 0, memoryUsed: 0, vmCount: 0, runningVmCount: 0 };
  const vCpuInMhz = (vdc as any).vCpuInMhz2 || 2000;
  
  const cpuCapacity = cpuLimit > 0 ? cpuLimit : cpuAllocated;
  const memCapacity = memLimit > 0 ? memLimit : memAllocated;
  
  const toVcpu = (mhz: number) => Math.round((mhz / vCpuInMhz) * 3);
  
  const cpuHealth = cpuCapacity > 0 && (cpuUsed / cpuCapacity) > 0.9;
  const memHealth = memCapacity > 0 && (memUsed / memCapacity) > 0.9;
  const ipHealth = ipTotal > 0 && (ipUsed / ipTotal) > 0.9;
  
  const isWarning = cpuHealth || memHealth || ipHealth;
  const isCritical = vdc.status !== undefined && vdc.status !== 1;

  const cpuData = {
    Used: toVcpu(cpuUsed),
    Limit: toVcpu(cpuCapacity),
    Reserved: toVcpu(cpuReserved),
    Units: 'vCPU',
    Allocated: toVcpu(cpuAllocated)
  };

  const memData = {
    Used: memUsed,
    Limit: memCapacity,
    Reserved: memReserved,
    Units: vdc.computeCapacity?.memory?.units || 'MB',
    Allocated: memAllocated
  };

  const ipData = {
    totalIpCount: ipTotal,
    usedIpCount: ipUsed,
    freeIpCount: ipAllocation.freeIpCount || (ipTotal - ipUsed),
    subnets: ipAllocation.subnets || []
  };

  const storageProfiles = vdc.storageProfiles || [];
  const hasComputeData = cpuAllocated > 0 || memAllocated > 0;
  const allocationType = vdc.allocationType || vdc.allocationModel || 'N/A';
  const orgFullName = vdc.orgFullName || vdc.org?.displayName || vdc.org?.name;
  const orgName = vdc.orgName || vdc.org?.name;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-colors duration-300 h-full flex flex-col" data-testid={`vdc-card-${vdc.id}`}>
      <CardHeader className="pb-3">
        <div className="flex flex-row items-start justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <CardTitle className="text-lg font-semibold tracking-tight truncate" data-testid={`org-fullname-${vdc.id}`}>
              {orgFullName || orgName || 'Unknown Organization'}
            </CardTitle>
            <div className="text-sm text-muted-foreground flex items-center gap-2" data-testid={`vdc-name-${vdc.id}`}>
              <Server className="h-3 w-3" />
              <span className="truncate">VDC: {vdc.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              {orgName && (
                <>
                  <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />Org ID: {orgName}</span>
                  <span>•</span>
                </>
              )}
              <span>{allocationType}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end shrink-0">
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px] uppercase tracking-widest border-opacity-50",
                !isCritical && !isWarning ? "border-green-500 text-green-500 bg-green-500/10" :
                isWarning ? "border-amber-500 text-amber-500 bg-amber-500/10" :
                "border-red-500 text-red-500 bg-red-500/10"
              )}
              data-testid={`vdc-status-${vdc.id}`}
            >
              {isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : 'HEALTHY'}
            </Badge>
            {isReportingDisabled && (
              <Badge
                variant="outline"
                className="border-amber-500 text-amber-500 bg-amber-500/10 text-[10px]"
                title={disabledReason || 'Excluded from reports'}
              >
                <EyeOff className="h-3 w-3 mr-1" />
                Disabled
              </Badge>
            )}
            <div className="flex gap-1">
              {onToggleReporting && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleReporting(!isReportingDisabled)}
                  data-testid={`button-toggle-reporting-${vdc.id}`}
                  className={cn(
                    "text-xs h-7 px-2",
                    isReportingDisabled && "border-amber-500 text-amber-500 hover:bg-amber-500/10"
                  )}
                  title={isReportingDisabled ? 'Enable in reports' : 'Disable from reports'}
                >
                  {isReportingDisabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                </Button>
              )}
              {onSetCommit && (
                <Button
                  variant={hasCommit ? "default" : "outline"}
                  size="sm"
                  onClick={onSetCommit}
                  data-testid={`button-commit-${vdc.id}`}
                  className={cn(
                    "text-xs h-7 px-2",
                    hasCommit && "bg-green-600 hover:bg-green-700"
                  )}
                >
                  <Settings2 className="h-3 w-3 mr-1" />
                  {hasCommit ? 'Commit Set' : 'Set Commit'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 flex-1">
        {/* VM Summary Section */}
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Server className="h-3 w-3" /> Virtual Machines
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
              <div className="text-2xl font-bold text-foreground">{vmResources.vmCount}</div>
              <div className="text-xs text-muted-foreground">Total VMs</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
              <div className="text-2xl font-bold text-green-500">{vmResources.runningVmCount}</div>
              <div className="text-xs text-muted-foreground">Running</div>
            </div>
          </div>
          {vCpuInMhz && (
            <div className="text-xs text-muted-foreground text-center">
              vCPU Speed: {(vCpuInMhz / 1000).toFixed(1)} GHz
            </div>
          )}
        </div>

        <Separator className="bg-border/50" />

        {/* Compute Section */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Cpu className="h-3 w-3" /> Compute Allocation
          </h4>
          {hasComputeData ? (
            <>
              <ResourceBar
                label="vCPU (3:1)"
                data={cpuData}
                color="bg-cyan-500"
                type="compute"
              />
              <ResourceBar
                label="Memory"
                data={memData}
                color="bg-purple-500"
                type="compute"
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic">No quota limits (Flex allocation)</p>
          )}
        </div>

        <Separator className="bg-border/50" />

        {/* Storage Section */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Database className="h-3 w-3" /> Storage Profiles
          </h4>
          {storageProfiles.length > 0 ? (
            <div className="space-y-4">
              {storageProfiles.map((profile, index) => (
                <ResourceBar
                  key={profile.id || index}
                  label={profile.name || 'Default'}
                  storageData={profile}
                  color="bg-emerald-500"
                  type="storage"
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No storage profiles configured</p>
          )}
        </div>

        <Separator className="bg-border/50" />

        {/* Network Section */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Globe className="h-3 w-3" /> Public IPs
          </h4>
          <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-center">
            <div className="text-2xl font-bold text-orange-500">{ipTotal}</div>
            <div className="text-xs text-muted-foreground">Allocated IPs</div>
          </div>
        </div>

        {/* Backup Section - only show when there's actual data */}
        {backupMetrics && (backupMetrics.protectedVmCount > 0 || backupMetrics.totalVmCount > 0 || backupMetrics.backupSizeGB > 0) && (
          <>
            <Separator className="bg-border/50" />
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Shield className="h-3 w-3" /> Backup Status
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-green-500" data-testid={`backup-protected-${vdc.id}`}>
                    {backupMetrics.protectedVmCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Protected VMs</div>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-blue-500" data-testid={`backup-storage-${vdc.id}`}>
                    {backupMetrics.backupSizeGB.toFixed(1)} GB
                  </div>
                  <div className="text-xs text-muted-foreground">Backup Storage</div>
                </div>
              </div>
              {backupMetrics.totalVmCount > 0 && (
                <div className="text-xs text-muted-foreground text-center">
                  {Math.round((backupMetrics.protectedVmCount / backupMetrics.totalVmCount) * 100)}% protection coverage
                </div>
              )}
            </div>
          </>
        )}

      </CardContent>
    </Card>
  );
}
