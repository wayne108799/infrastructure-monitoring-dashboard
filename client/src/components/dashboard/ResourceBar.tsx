import { CapacityWithUsage, VdcStorageProfile } from '@/lib/mockData';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface ResourceBarProps {
  label: string;
  data?: CapacityWithUsage; // For Compute
  storageData?: VdcStorageProfile; // For Storage
  color: string;
  isStorage?: boolean;
}

export function ResourceBar({ label, data, storageData, color, isStorage = false }: ResourceBarProps) {
  let used = 0;
  let limit = 0;
  let reserved = 0;
  let unit = '';
  let displayTotal = '';
  let displayUsed = '';

  if (isStorage && storageData) {
    // Storage Logic (MB to GB/TB conversion for display)
    used = storageData.used;
    limit = storageData.limit;
    reserved = 0; // Storage profiles usually don't have "reservation" in the same way CPU does
    unit = storageData.units;
    
    // Format helpers
    const toGB = (mb: number) => (mb / 1024).toFixed(1);
    const toTB = (mb: number) => (mb / 1024 / 1024).toFixed(2);
    
    const isTB = limit > 1000000;
    displayUsed = isTB ? toTB(used) : toGB(used);
    displayTotal = isTB ? `${toTB(limit)} TB` : `${toGB(limit)} GB`;
  } else if (data) {
    // Compute Logic
    used = data.Used;
    limit = data.Limit === 0 ? data.Used * 1.5 : data.Limit; // Handle unlimited (PAYG)
    reserved = data.Reserved;
    unit = data.Units;
    
    // Format helpers
    const isMHz = unit === 'MHz';
    const displayUnit = isMHz ? 'GHz' : 'GB';
    const div = isMHz ? 1000 : 1024;
    
    displayUsed = (used / div).toFixed(1);
    displayTotal = data.Limit === 0 
      ? 'Uncapped' 
      : `${(limit / div).toFixed(1)} ${displayUnit}`;
  }

  const usedPct = limit > 0 ? (used / limit) * 100 : 0;
  const reservedPct = limit > 0 ? (reserved / limit) * 100 : 0;
  
  // PAYG Special case: If limit is 0, it's unlimited, so we show a "usage only" bar or fix scale
  const isUnlimited = !isStorage && data?.Limit === 0;
  const barWidth = isUnlimited ? 100 : Math.min(usedPct, 100); // Just fill it for PAYG visual or handle differently
  
  // Status colors
  const statusColor = !isUnlimited && usedPct > 90 ? 'bg-red-500' : !isUnlimited && usedPct > 75 ? 'bg-amber-500' : color;

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className="text-right">
          <div className="text-lg font-mono font-medium text-foreground">
            {displayUsed} <span className="text-xs text-muted-foreground">/ {displayTotal}</span>
          </div>
        </div>
      </div>
      
      {/* Progress Bar Container */}
      <div className="h-3 w-full bg-secondary/50 rounded-sm overflow-hidden relative">
        {/* Reserved Marker (Ghost bar) - Only for Compute */}
        {!isStorage && (
          <div 
            className="absolute top-0 left-0 h-full bg-primary/20 z-0 border-r border-primary/50"
            style={{ width: `${Math.min(reservedPct, 100)}%` }}
          />
        )}
        
        {/* Used Bar */}
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${barWidth}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
          className={cn("h-full z-10 relative", statusColor, isUnlimited && "opacity-50")}
        />
      </div>

      <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
        <span>Used: {isUnlimited ? 'N/A' : usedPct.toFixed(1)}%</span>
        {!isStorage && <span>Rsrv: {reservedPct.toFixed(1)}%</span>}
      </div>
    </div>
  );
}
