import { ResourceBar } from './ResourceBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Cpu, Database, Globe, Building2 } from 'lucide-react';
import type { OrgVdc } from '@/lib/api';

interface VDCDetailCardProps {
  vdc: OrgVdc;
}

export function VDCDetailCard({ vdc }: VDCDetailCardProps) {
  const cpuUsed = vdc.computeCapacity?.cpu?.used || 0;
  const cpuLimit = vdc.computeCapacity?.cpu?.limit || 0;
  const memUsed = vdc.computeCapacity?.memory?.used || 0;
  const memLimit = vdc.computeCapacity?.memory?.limit || 0;
  const ipUsed = vdc.network?.allocatedIps?.usedIpCount || 0;
  const ipTotal = vdc.network?.allocatedIps?.totalIpCount || 0;
  
  const cpuHealth = cpuLimit > 0 && (cpuUsed / cpuLimit) > 0.9;
  const memHealth = memLimit > 0 && (memUsed / memLimit) > 0.9;
  const ipHealth = ipTotal > 0 && (ipUsed / ipTotal) > 0.9;
  
  const isWarning = cpuHealth || memHealth || ipHealth;
  const isCritical = vdc.status !== undefined && vdc.status !== 1;

  const cpuData = {
    Used: cpuUsed,
    Limit: cpuLimit,
    Reserved: vdc.computeCapacity?.cpu?.reserved || 0,
    Units: vdc.computeCapacity?.cpu?.units || 'MHz',
    Allocated: vdc.computeCapacity?.cpu?.allocated || 0
  };

  const memData = {
    Used: memUsed,
    Limit: memLimit,
    Reserved: vdc.computeCapacity?.memory?.reserved || 0,
    Units: vdc.computeCapacity?.memory?.units || 'MB',
    Allocated: vdc.computeCapacity?.memory?.allocated || 0
  };

  const ipData = {
    totalIpCount: ipTotal,
    usedIpCount: ipUsed,
    freeIpCount: vdc.network?.allocatedIps?.freeIpCount || (ipTotal - ipUsed),
    subnets: vdc.network?.allocatedIps?.subnets || []
  };

  const storageProfiles = vdc.storageProfiles || [];
  const hasComputeData = cpuLimit > 0 || memLimit > 0;
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
        {/* Compute Section */}
        {hasComputeData ? (
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Cpu className="h-3 w-3" /> Compute Resources
            </h4>
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
          </div>
        ) : (
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Cpu className="h-3 w-3" /> Compute Resources
            </h4>
            <p className="text-sm text-muted-foreground italic">Flex allocation - compute on demand</p>
          </div>
        )}

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
