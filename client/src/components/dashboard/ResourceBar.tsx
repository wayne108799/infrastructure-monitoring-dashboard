import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface ComputeData {
  Used: number;
  Limit: number;
  Reserved: number;
  Units: string;
  Allocated: number;
}

interface StorageData {
  id?: string;
  name?: string;
  limit?: number;
  used?: number;
  units?: string;
}

interface IpData {
  totalIpCount: number;
  usedIpCount: number;
  freeIpCount: number;
  subnets?: any[];
}

interface ResourceBarProps {
  label: string;
  data?: ComputeData;
  storageData?: StorageData;
  ipData?: IpData;
  color: string;
  type?: 'compute' | 'storage' | 'network';
}

export function ResourceBar({ label, data, storageData, ipData, color, type = 'compute' }: ResourceBarProps) {
  let used = 0;
  let limit = 0;
  let reserved = 0;
  let displayTotal = '';
  let displayUsed = '';
  let unit = '';
  let isUnlimited = false;

  if (type === 'storage' && storageData) {
    used = storageData.used || 0;
    limit = storageData.limit || 0;
    unit = storageData.units || 'MB';
    
    const toGB = (mb: number) => (mb / 1024).toFixed(1);
    const toTB = (mb: number) => (mb / 1024 / 1024).toFixed(2);
    const isTB = limit > 1000000;
    
    displayUsed = isTB ? toTB(used) : toGB(used);
    displayTotal = isTB ? `${toTB(limit)} TB` : `${toGB(limit)} GB`;
  } else if (type === 'network' && ipData) {
    used = ipData.usedIpCount || 0;
    limit = ipData.totalIpCount || 0;
    displayUsed = used.toString();
    displayTotal = `${limit} IPs`;
  } else if (data) {
    used = data.Used || 0;
    limit = data.Limit === 0 ? (data.Used || 0) * 1.5 : (data.Limit || 0);
    reserved = data.Reserved || 0;
    unit = data.Units || 'MHz';
    isUnlimited = data.Limit === 0;
    
    const isMHz = unit === 'MHz';
    const displayUnit = isMHz ? 'GHz' : 'GB';
    const div = isMHz ? 1000 : 1024;
    
    displayUsed = (used / div).toFixed(1);
    displayTotal = isUnlimited ? 'Uncapped' : `${(limit / div).toFixed(1)} ${displayUnit}`;
  }

  const usedPct = limit > 0 ? (used / limit) * 100 : 0;
  const reservedPct = limit > 0 && type === 'compute' ? (reserved / limit) * 100 : 0;
  
  const barWidth = isUnlimited ? 100 : Math.min(usedPct, 100);
  
  // Status colors
  const statusColor = 
    !isUnlimited && usedPct > 90 ? 'bg-red-500' : 
    !isUnlimited && usedPct > 75 ? 'bg-amber-500' : 
    color;

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
        {type === 'compute' && (
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
        {type === 'compute' && !isUnlimited && <span>Rsrv: {reservedPct.toFixed(1)}%</span>}
        {type === 'network' && <span>Free: {ipData?.freeIpCount}</span>}
      </div>
    </div>
  );
}
