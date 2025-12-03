import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { mockSites } from '@/lib/mockData';
import { VDCDetailCard } from '@/components/dashboard/VDCDetailCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, Server, Database, Globe, Network } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>(mockSites[0].id);
  
  const selectedSite = mockSites.find(s => s.id === selectedSiteId) || mockSites[0];

  // Aggregate stats for the site
  const siteStats = selectedSite.orgVdcs.reduce((acc, vdc) => ({
    totalCpuUsed: acc.totalCpuUsed + vdc.computeCapacity.Cpu.Used,
    totalCpuLimit: acc.totalCpuLimit + vdc.computeCapacity.Cpu.Limit,
    totalMemUsed: acc.totalMemUsed + vdc.computeCapacity.Memory.Used,
    totalMemLimit: acc.totalMemLimit + vdc.computeCapacity.Memory.Limit,
    totalStorageUsed: acc.totalStorageUsed + vdc.storageProfiles.reduce((s, p) => s + p.used, 0),
    totalStorageLimit: acc.totalStorageLimit + vdc.storageProfiles.reduce((s, p) => s + p.limit, 0),
    totalIpsUsed: acc.totalIpsUsed + vdc.network.allocatedIps.usedIpCount,
    totalIpsLimit: acc.totalIpsLimit + vdc.network.allocatedIps.totalIpCount,
    vdcCount: acc.vdcCount + 1
  }), { 
    totalCpuUsed: 0, totalCpuLimit: 0, 
    totalMemUsed: 0, totalMemLimit: 0,
    totalStorageUsed: 0, totalStorageLimit: 0,
    totalIpsUsed: 0, totalIpsLimit: 0,
    vdcCount: 0
  });

  // Helpers for display
  const toGHz = (mhz: number) => (mhz / 1000).toFixed(0);
  const toGB = (mb: number) => (mb / 1024).toFixed(0);
  const toTB = (mb: number) => (mb / 1024 / 1024).toFixed(1);

  return (
    <DashboardLayout>
      
      {/* Site Selector & Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Infrastructure Overview</h1>
          <p className="text-muted-foreground mt-1">Monitor Organization VDCs and resource consumption.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground font-medium">Select Site:</span>
          <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
            <SelectTrigger className="w-[260px] bg-card border-border">
              <SelectValue placeholder="Select a site" />
            </SelectTrigger>
            <SelectContent>
              {mockSites.map(site => (
                <SelectItem key={site.id} value={site.id}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${site.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-medium">{site.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{site.location}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* High Level Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard 
          title="Org VDCs" 
          value={siteStats.vdcCount.toString()} 
          icon={Server} 
          trend="Active" 
          trendUp={true}
        />
        <StatCard 
          title="CPU Allocation" 
          value={`${Math.round((siteStats.totalCpuUsed / (siteStats.totalCpuLimit || 1)) * 100)}%`} 
          icon={Activity} 
          subtext={`${toGHz(siteStats.totalCpuUsed)} / ${toGHz(siteStats.totalCpuLimit)} GHz`}
        />
        <StatCard 
          title="Public IP Usage" 
          value={`${siteStats.totalIpsUsed} / ${siteStats.totalIpsLimit}`}
          icon={Globe} 
          subtext={`${siteStats.totalIpsLimit - siteStats.totalIpsUsed} Available`}
          warning={siteStats.totalIpsUsed / siteStats.totalIpsLimit > 0.9}
        />
        <Card className="bg-card border-border relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-muted-foreground">Storage Used</h3>
                <Database className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-bold font-mono">{toTB(siteStats.totalStorageUsed)} TB</div>
              <p className="text-xs text-muted-foreground mt-1">of {toTB(siteStats.totalStorageLimit)} TB Total Capacity</p>
            </CardContent>
        </Card>
      </div>

      {/* VDC Grid */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          Organization VDCs
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {selectedSite.orgVdcs.map((vdc, idx) => (
            <motion.div
              key={vdc.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="h-full"
            >
              <VDCDetailCard vdc={vdc} />
            </motion.div>
          ))}
        </div>
      </div>

    </DashboardLayout>
  );
}

function StatCard({ title, value, icon: Icon, trend, trendUp, subtext, warning }: any) {
  return (
    <Card className={cn("bg-card border-border", warning && "border-amber-500/50 bg-amber-500/5")}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <Icon className={cn("h-4 w-4", warning ? "text-amber-500" : "text-muted-foreground")} />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className={cn("text-2xl font-bold font-mono", warning && "text-amber-500")}>{value}</div>
            {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
          </div>
          {trend && (
            <div className={`text-xs font-medium px-2 py-1 rounded-full ${trendUp ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
              {trend}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
