import { ResourceBar } from './ResourceBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Cpu, Database, Globe } from 'lucide-react';
import type { OrgVdc } from '@/lib/api';

interface VDCDetailCardProps {
  vdc: OrgVdc;
}

export function VDCDetailCard({ vdc }: VDCDetailCardProps) {
  // Determine health based on usage vs limit
  const cpuHealth = vdc.computeCapacity.cpu.limit > 0 && (vdc.computeCapacity.cpu.used / vdc.computeCapacity.cpu.limit) > 0.9;
  const memHealth = vdc.computeCapacity.memory.limit > 0 && (vdc.computeCapacity.memory.used / vdc.computeCapacity.memory.limit) > 0.9;
  const ipHealth = (vdc.network.allocatedIps.usedIpCount / vdc.network.allocatedIps.totalIpCount) > 0.9;
  
  const isWarning = cpuHealth || memHealth || ipHealth;
  const isCritical = vdc.status !== 1;

  // Transform data for ResourceBar component
  const cpuData = {
    Used: vdc.computeCapacity.cpu.used,
    Limit: vdc.computeCapacity.cpu.limit,
    Reserved: vdc.computeCapacity.cpu.reserved,
    Units: vdc.computeCapacity.cpu.units,
    Allocated: vdc.computeCapacity.cpu.allocated
  };

  const memData = {
    Used: vdc.computeCapacity.memory.used,
    Limit: vdc.computeCapacity.memory.limit,
    Reserved: vdc.computeCapacity.memory.reserved,
    Units: vdc.computeCapacity.memory.units,
    Allocated: vdc.computeCapacity.memory.allocated
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-colors duration-300 h-full flex flex-col" data-testid={`vdc-card-${vdc.id}`}>
      <CardHeader className="pb-3">
        <div className="flex flex-row items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-medium tracking-tight flex items-center gap-2" data-testid={`vdc-name-${vdc.id}`}>
              {vdc.name}
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
              <span className="truncate max-w-[150px]" title={vdc.id}>{vdc.id.split(':').pop()}</span>
              <span>•</span>
              <span>{vdc.allocationModel}</span>
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

        <Separator className="bg-border/50" />

        {/* Storage Section */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Database className="h-3 w-3" /> Storage Profiles
          </h4>
          <div className="space-y-4">
            {vdc.storageProfiles.map((profile) => (
              <ResourceBar
                key={profile.id}
                label={profile.name}
                storageData={profile}
                color="bg-emerald-500"
                type="storage"
              />
            ))}
          </div>
        </div>

        <Separator className="bg-border/50" />

        {/* Network Section */}
        <div className="space-y-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Globe className="h-3 w-3" /> Network Allocations
          </h4>
          <ResourceBar
            label="Public IPs"
            ipData={vdc.network.allocatedIps}
            color="bg-orange-500"
            type="network"
          />
        </div>

      </CardContent>
    </Card>
  );
}
