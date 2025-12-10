import React from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Server, Activity, Settings, Cloud, PanelLeft, List, FileSpreadsheet, PlusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

function AppSidebar() {
  const [location] = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === 'collapsed';

  const navItems = [
    { icon: LayoutDashboard, label: 'Overview', href: '/' },
    { icon: List, label: 'Details', href: '/details' },
    { icon: FileSpreadsheet, label: 'Report', href: '/report' },
    { icon: PlusCircle, label: 'Provision', href: '/provision' },
    { icon: Settings, label: 'Settings', href: '/settings' },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="h-16 flex items-center px-4 border-b border-sidebar-border">
        <div className={cn(
          "flex items-center gap-2 text-primary transition-all duration-200",
          isCollapsed ? "justify-center w-full" : ""
        )}>
          <Cloud className="h-6 w-6 shrink-0" />
          {!isCollapsed && (
            <span className="font-bold text-lg tracking-tight text-foreground whitespace-nowrap">VCD Monitor</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="p-2">
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={location === item.href}
                tooltip={item.label}
              >
                <Link href={item.href} data-testid={`link-nav-${item.label.toLowerCase()}`}>
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <div className={cn(
          "flex items-center gap-3 transition-all duration-200",
          isCollapsed && "justify-center"
        )}>
          <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-mono text-sidebar-foreground shrink-0">
            AD
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-foreground truncate">Admin User</span>
              <span className="text-[10px] text-muted-foreground truncate">vcd-admin@corp.local</span>
            </div>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function SidebarToggleButton() {
  const { toggleSidebar, state } = useSidebar();
  
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSidebar}
      className="h-8 w-8 mr-4"
      data-testid="button-toggle-sidebar"
      title={state === 'collapsed' ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <PanelLeft className="h-5 w-5" />
    </Button>
  );
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen bg-background text-foreground flex font-sans selection:bg-primary selection:text-primary-foreground w-full">
        <AppSidebar />

        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="h-16 border-b border-border bg-background/50 backdrop-blur-sm flex items-center justify-between px-6 sticky top-0 z-10">
            <div className="flex items-center text-sm text-muted-foreground">
              <SidebarToggleButton />
              <span className="text-primary">System</span>
              <span className="mx-2">/</span>
              <span className="text-foreground">Dashboard</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse"></div>
              <span className="text-xs font-mono text-green-500">SYSTEM OPERATIONAL</span>
            </div>
          </header>

          <div className="flex-1 overflow-auto p-8">
            <div className="max-w-7xl mx-auto space-y-8">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
