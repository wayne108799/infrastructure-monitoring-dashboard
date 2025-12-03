import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { mockSites, Site } from '@/lib/mockData';
import { VDCDetailCard } from '@/components/dashboard/VDCDetailCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, Server, Database, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Dashboard() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>(mockSites[0].id);
  
  const selectedSite = mockSites.find(s => s.id === selectedSiteId) || mockSites[0];

  // Aggregate stats for the site
  const siteStats = selectedSite.vdcs.reduce((acc, vdc) => ({
    totalVMs: acc.totalVMs + vdc.vms,
    totalCpuUsed: acc.totalCpuUsed + vdc.cpu.used,
    totalCpuTotal: acc.totalCpuTotal + vdc.cpu.total,
    totalMemUsed: acc.totalMemUsed + vdc.memory.used,
    totalMemTotal: acc.totalMemTotal + vdc.memory.total,
  }), { totalVMs: 0, totalCpuUsed: 0, totalCpuTotal: 0, totalMemUsed: 0, totalMemTotal: 0 });

  return (
    <DashboardLayout>
      
      {/* Site Selector & Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Infrastructure Overview</h1>
          <p className="text-muted-foreground mt-1">Monitor resource consumption across virtual data centers.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground font-medium">Select Site:</span>
          <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
            <SelectTrigger className="w-[240px] bg-card border-border">
              <SelectValue placeholder="Select a site" />
            </SelectTrigger>
            <SelectContent>
              {mockSites.map(site => (
                <SelectItem key={site.id} value={site.id}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${site.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                    {site.name}
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
          title="Total VMs" 
          value={siteStats.totalVMs.toString()} 
          icon={Server} 
          trend="+12%" 
          trendUp={true}
        />
        <StatCard 
          title="CPU Utilization" 
          value={`${Math.round((siteStats.totalCpuUsed / siteStats.totalCpuTotal) * 100)}%`} 
          icon={Activity} 
          subtext={`${siteStats.totalCpuUsed} / ${siteStats.totalCpuTotal} GHz`}
        />
        <StatCard 
          title="Memory Usage" 
          value={`${Math.round((siteStats.totalMemUsed / siteStats.totalMemTotal) * 100)}%`} 
          icon={Database} 
          subtext={`${siteStats.totalMemUsed.toFixed(1)} / ${siteStats.totalMemTotal.toFixed(1)} TB`}
        />
        <Card className="bg-card border-border relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full -mr-8 -mt-8 blur-2xl"></div>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-muted-foreground">Site Status</h3>
                {selectedSite.status === 'online' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              </div>
              <div className="text-2xl font-bold capitalize">{selectedSite.status}</div>
              <p className="text-xs text-muted-foreground mt-1">{selectedSite.location}</p>
            </CardContent>
        </Card>
      </div>

      {/* VDC Grid */}
      <div>
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <CloudServerIcon className="h-5 w-5 text-primary" />
          Virtual Data Centers
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {selectedSite.vdcs.map((vdc, idx) => (
            <motion.div
              key={vdc.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <VDCDetailCard vdc={vdc} />
            </motion.div>
          ))}
        </div>
      </div>

    </DashboardLayout>
  );
}

function StatCard({ title, value, icon: Icon, trend, trendUp, subtext }: any) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-2xl font-bold font-mono">{value}</div>
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

function CloudServerIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  )
}
