import { OrgVdc } from '@/lib/mockData';
import { ResourceBar } from './ResourceBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { HardDrive, Cpu, MemoryStick, Database } from 'lucide-react';

interface VDCDetailCardProps {
  vdc: OrgVdc;
}

export function VDCDetailCard({ vdc }: VDCDetailCardProps) {
  // Determine health based on usage vs limit (if limit exists)
  const cpuHealth = vdc.computeCapacity.Cpu.Limit > 0 && (vdc.computeCapacity.Cpu.Used / vdc.computeCapacity.Cpu.Limit) > 0.9;
  const memHealth = vdc.computeCapacity.Memory.Limit > 0 && (vdc.computeCapacity.Memory.Used / vdc.computeCapacity.Memory.Limit) > 0.9;
  
  const isWarning = cpuHealth || memHealth;
  const isCritical = vdc.status !== 1; // 1 is Ready

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-colors duration-300 h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex flex-row items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-medium tracking-tight flex items-center gap-2">
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
            data={vdc.computeCapacity.Cpu} 
            color="bg-cyan-500" 
          />
          <ResourceBar 
            label="Memory" 
            data={vdc.computeCapacity.Memory} 
            color="bg-purple-500" 
          />
        </div>

        <Separator className="bg-border/50" />

        {/* Storage Section - Iterate Profiles */}
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
                isStorage={true}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
