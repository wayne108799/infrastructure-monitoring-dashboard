import { ResourceBar } from './ResourceBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Cpu, Database, Globe, Building2, Server } from 'lucide-react';
import type { OrgVdc } from '@/lib/api';

interface VDCDetailCardProps {
  vdc: OrgVdc;
}

export function VDCDetailCard({ vdc }: VDCDetailCardProps) {
  const cpuAllocated = vdc.computeCapacity?.cpu?.allocated || 0;
  const cpuLimit = vdc.computeCapacity?.cpu?.limit || 0;
  const cpuReserved = vdc.computeCapacity?.cpu?.reserved || 0;
  const cpuUsed = vdc.computeCapacity?.cpu?.used || 0;
  
  const memAllocated = vdc.computeCapacity?.memory?.allocated || 0;
  const memLimit = vdc.computeCapacity?.memory?.limit || 0;
  const memReserved = vdc.computeCapacity?.memory?.reserved || 0;
  const memUsed = vdc.computeCapacity?.memory?.used || 0;
  
  const ipUsed = vdc.network?.allocatedIps?.usedIpCount || 0;
  const ipTotal = vdc.network?.allocatedIps?.totalIpCount || 0;
  
  const vmResources = (vdc as any).vmResources || { cpuUsed: 0, memoryUsed: 0, vmCount: 0, runningVmCount: 0 };
  const vCpuInMhz = (vdc as any).vCpuInMhz2 || 2000;
  
  const cpuCapacity = cpuLimit > 0 ? cpuLimit : cpuAllocated;
  const memCapacity = memLimit > 0 ? memLimit : memAllocated;
  
  const cpuHealth = cpuCapacity > 0 && (cpuUsed / cpuCapacity) > 0.9;
  const memHealth = memCapacity > 0 && (memUsed / memCapacity) > 0.9;
  const ipHealth = ipTotal > 0 && (ipUsed / ipTotal) > 0.9;
  
  const isWarning = cpuHealth || memHealth || ipHealth;
  const isCritical = vdc.status !== undefined && vdc.status !== 1;

  const cpuData = {
    Used: cpuUsed,
    Limit: cpuCapacity,
    Reserved: cpuReserved,
    Units: vdc.computeCapacity?.cpu?.units || 'MHz',
    Allocated: cpuAllocated
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
    freeIpCount: vdc.network?.allocatedIps?.freeIpCount || (ipTotal - ipUsed),
    subnets: vdc.network?.allocatedIps?.subnets || []
  };

  const storageProfiles = vdc.storageProfiles || [];
  const hasComputeData = cpuAllocated > 0 || memAllocated > 0;
  const allocationType = vdc.allocationType || vdc.allocationModel || 'N/A';
  const orgName = vdc.org?.name;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-colors duration-300 h-full flex flex-col" data-testid={`vdc-card-${vdc.id}`}>
      <CardHeader className="pb-3">
        <div className="flex flex-row items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-medium tracking-tight flex items-center gap-2" data-testid={`vdc-name-${vdc.id}`}>
              {vdc.name}
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              {orgName && (
                <>
                  <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{orgName}</span>
                  <span>•</span>
                </>
              )}
              <span>{allocationType}</span>
            </div>
          </div>
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
                label="CPU"
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
            <Globe className="h-3 w-3" /> Network Allocations
          </h4>
          <ResourceBar
            label="Public IPs"
            ipData={ipData}
            color="bg-orange-500"
            type="network"
          />
        </div>

      </CardContent>
    </Card>
  );
}
