import { ResourceUsage } from '@/lib/mockData';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface ResourceBarProps {
  label: string;
  data: ResourceUsage;
  color: string;
}

export function ResourceBar({ label, data, color }: ResourceBarProps) {
  const usedPct = (data.used / data.total) * 100;
  const reservedPct = (data.reserved / data.total) * 100;
  
  // Determine status color based on usage
  const statusColor = usedPct > 90 ? 'bg-red-500' : usedPct > 75 ? 'bg-amber-500' : color;
  
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className="text-right">
          <div className="text-lg font-mono font-medium text-foreground">
            {data.used} <span className="text-xs text-muted-foreground">/ {data.total} {data.unit}</span>
          </div>
        </div>
      </div>
      
      {/* Progress Bar Container */}
      <div className="h-3 w-full bg-secondary/50 rounded-sm overflow-hidden relative">
        {/* Reserved Marker (Ghost bar) */}
        <div 
          className="absolute top-0 left-0 h-full bg-primary/20 z-0 border-r border-primary/50"
          style={{ width: `${Math.min(reservedPct, 100)}%` }}
        />
        
        {/* Used Bar */}
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(usedPct, 100)}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={cn("h-full z-10 relative", statusColor)}
        />
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
        <span>Used: {usedPct.toFixed(1)}%</span>
        <span className="text-primary/80">Rsrv: {data.reserved} {data.unit}</span>
      </div>
    </div>
  );
}
