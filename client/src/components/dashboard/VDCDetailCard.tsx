import { VDC } from '@/lib/mockData';
import { ResourceBar } from './ResourceBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { HardDrive, Cpu, MemoryStick } from 'lucide-react';

interface VDCDetailCardProps {
  vdc: VDC;
}

export function VDCDetailCard({ vdc }: VDCDetailCardProps) {
  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/30 transition-colors duration-300">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-1">
          <CardTitle className="text-lg font-medium tracking-tight flex items-center gap-2">
            {vdc.name}
            <Badge 
              variant="outline" 
              className={cn(
                "ml-2 font-mono text-[10px] uppercase tracking-widest border-opacity-50",
                vdc.status === 'healthy' ? "border-green-500 text-green-500 bg-green-500/10" :
                vdc.status === 'warning' ? "border-amber-500 text-amber-500 bg-amber-500/10" :
                "border-red-500 text-red-500 bg-red-500/10"
              )}
            >
              {vdc.status}
            </Badge>
          </CardTitle>
          <div className="text-xs text-muted-foreground font-mono">ID: {vdc.id} • {vdc.vms} Active VMs</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-4">
        <ResourceBar 
          label="CPU Allocation" 
          data={vdc.cpu} 
          color="bg-cyan-500" 
        />
        <ResourceBar 
          label="Memory Usage" 
          data={vdc.memory} 
          color="bg-purple-500" 
        />
        <ResourceBar 
          label="Storage Capacity" 
          data={vdc.storage} 
          color="bg-emerald-500" 
        />
      </CardContent>
    </Card>
  );
}
