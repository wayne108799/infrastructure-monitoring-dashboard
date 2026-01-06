import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'wouter';
import { 
  Plus, 
  Pencil, 
  Trash2, 
  TestTube, 
  Server, 
  Cloud,
  HardDrive,
  ArrowLeft,
  Loader2,
  CheckCircle,
  XCircle,
  Settings as SettingsIcon
} from 'lucide-react';
import {
  fetchConfiguredSites,
  createSiteConfig,
  updateSiteConfig,
  deleteSiteConfig,
  testSiteConfigConnection,
  getPlatformDisplayName,
  getPlatformShortName,
  getPlatformColor,
  fetchStorageConfig,
  fetchDiscoveredStorage,
  saveStorageConfig,
  type PlatformSiteConfig,
  type CreatePlatformSiteConfig,
  type PlatformType,
  type SiteStorageConfig,
  type DiscoveredStorageTier
} from '@/lib/api';

function getPlatformIcon(type: PlatformType) {
  switch (type) {
    case 'vcd':
      return <Cloud className="h-5 w-5" />;
    case 'cloudstack':
      return <Server className="h-5 w-5" />;
    case 'proxmox':
      return <HardDrive className="h-5 w-5" />;
    default:
      return <Server className="h-5 w-5" />;
  }
}

interface SiteFormData {
  siteId: string;
  platformType: PlatformType;
  name: string;
  location: string;
  url: string;
  username: string;
  password: string;
  org: string;
  apiKey: string;
  secretKey: string;
  realm: string;
  isEnabled: boolean;
  vcenterUrl: string;
  vcenterUsername: string;
  vcenterPassword: string;
  nsxUrl: string;
  ariaUrl: string;
  vspcUrl: string;
  vspcUsername: string;
  vspcPassword: string;
}

const initialFormData: SiteFormData = {
  siteId: '',
  platformType: 'vcd',
  name: '',
  location: '',
  url: '',
  username: '',
  password: '',
  org: '',
  apiKey: '',
  secretKey: '',
  realm: 'pam',
  isEnabled: true,
  vcenterUrl: '',
  vcenterUsername: '',
  vcenterPassword: '',
  nsxUrl: '',
  ariaUrl: '',
  vspcUrl: '',
  vspcUsername: '',
  vspcPassword: '',
};

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<PlatformSiteConfig | null>(null);
  const [formData, setFormData] = useState<SiteFormData>(initialFormData);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  
  // Storage config state
  const [storageConfigSite, setStorageConfigSite] = useState<PlatformSiteConfig | null>(null);
  const [storageConfigs, setStorageConfigs] = useState<SiteStorageConfig[]>([]);
  const [discoveredTiers, setDiscoveredTiers] = useState<DiscoveredStorageTier[]>([]);
  const [loadingDiscoveredTiers, setLoadingDiscoveredTiers] = useState(false);
  const [platformConnected, setPlatformConnected] = useState(false);
  const [newTierName, setNewTierName] = useState('');
  const [newTierCapacity, setNewTierCapacity] = useState('');
  const [savingStorage, setSavingStorage] = useState(false);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [editingCapacity, setEditingCapacity] = useState('');

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['configuredSites'],
    queryFn: fetchConfiguredSites,
  });

  const createMutation = useMutation({
    mutationFn: createSiteConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuredSites'] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['globalSummary'] });
      setIsAddDialogOpen(false);
      setFormData(initialFormData);
      toast({
        title: 'Site Created',
        description: 'The platform connection has been added successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, config }: { id: string; config: Partial<CreatePlatformSiteConfig> }) =>
      updateSiteConfig(id, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuredSites'] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['globalSummary'] });
      setEditingSite(null);
      setFormData(initialFormData);
      toast({
        title: 'Site Updated',
        description: 'The platform connection has been updated successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSiteConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuredSites'] });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      queryClient.invalidateQueries({ queryKey: ['globalSummary'] });
      toast({
        title: 'Site Deleted',
        description: 'The platform connection has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleTestConnection = async (siteId: string) => {
    setTestingConnection(siteId);
    try {
      const result = await testSiteConfigConnection(siteId);
      if (result.success) {
        toast({
          title: 'Connection Successful',
          description: result.message || 'Successfully connected to the platform.',
        });
      } else {
        toast({
          title: 'Connection Failed',
          description: result.error || result.message || 'Could not connect to the platform.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Connection Test Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setTestingConnection(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const config: CreatePlatformSiteConfig = {
      siteId: formData.siteId,
      platformType: formData.platformType,
      name: formData.name,
      location: formData.location,
      url: formData.url,
      isEnabled: formData.isEnabled,
    };

    // Don't send password if it's the masked placeholder (keep existing password on server)
    const isPasswordMasked = (pwd: string) => pwd === '********';
    
    if (formData.platformType === 'vcd') {
      config.username = formData.username;
      if (!isPasswordMasked(formData.password)) {
        config.password = formData.password;
      }
      config.org = formData.org;
      // Include management links for VCD
      if (formData.vcenterUrl) config.vcenterUrl = formData.vcenterUrl;
      if (formData.vcenterUsername) config.vcenterUsername = formData.vcenterUsername;
      if (formData.vcenterPassword && !isPasswordMasked(formData.vcenterPassword)) {
        config.vcenterPassword = formData.vcenterPassword;
      }
      if (formData.nsxUrl) config.nsxUrl = formData.nsxUrl;
      if (formData.ariaUrl) config.ariaUrl = formData.ariaUrl;
      // Include VSPC configuration for VCD
      if (formData.vspcUrl) config.vspcUrl = formData.vspcUrl;
      if (formData.vspcUsername) config.vspcUsername = formData.vspcUsername;
      if (formData.vspcPassword && !isPasswordMasked(formData.vspcPassword)) {
        config.vspcPassword = formData.vspcPassword;
      }
    } else if (formData.platformType === 'cloudstack') {
      config.apiKey = formData.apiKey;
      if (!isPasswordMasked(formData.secretKey)) {
        config.secretKey = formData.secretKey;
      }
    } else if (formData.platformType === 'proxmox') {
      config.username = formData.username;
      if (!isPasswordMasked(formData.password)) {
        config.password = formData.password;
      }
      config.realm = formData.realm;
    }

    if (editingSite) {
      updateMutation.mutate({ id: editingSite.id, config });
    } else {
      createMutation.mutate(config);
    }
  };

  const handleEdit = (site: PlatformSiteConfig) => {
    setEditingSite(site);
    setFormData({
      siteId: site.siteId,
      platformType: site.platformType,
      name: site.name,
      location: site.location,
      url: site.url,
      username: site.username || '',
      password: site.password || '',
      org: site.org || '',
      apiKey: site.apiKey || '',
      secretKey: site.secretKey || '',
      realm: site.realm || 'pam',
      isEnabled: site.isEnabled !== false,
      vcenterUrl: site.vcenterUrl || '',
      vcenterUsername: site.vcenterUsername || '',
      vcenterPassword: site.vcenterPassword || '',
      nsxUrl: site.nsxUrl || '',
      ariaUrl: site.ariaUrl || '',
      vspcUrl: site.vspcUrl || '',
      vspcUsername: site.vspcUsername || '',
      vspcPassword: site.vspcPassword || '',
    });
  };

  const handleCloseDialog = () => {
    setIsAddDialogOpen(false);
    setEditingSite(null);
    setFormData(initialFormData);
  };

  // Storage config handlers
  const handleOpenStorageConfig = async (site: PlatformSiteConfig) => {
    setStorageConfigSite(site);
    setNewTierName('');
    setNewTierCapacity('');
    setEditingTier(null);
    setEditingCapacity('');
    setLoadingDiscoveredTiers(true);
    
    try {
      // Fetch discovered tiers with overrides merged
      const discovered = await fetchDiscoveredStorage(site.siteId);
      setDiscoveredTiers(discovered.tiers);
      setPlatformConnected(discovered.platformConnected);
      
      // Also fetch raw configs for reference
      const configs = await fetchStorageConfig(site.siteId);
      setStorageConfigs(configs);
    } catch (error) {
      setDiscoveredTiers([]);
      setStorageConfigs([]);
      setPlatformConnected(false);
    } finally {
      setLoadingDiscoveredTiers(false);
    }
  };

  const handleSaveStorageTier = async () => {
    if (!storageConfigSite || !newTierName || !newTierCapacity) return;
    
    setSavingStorage(true);
    try {
      await saveStorageConfig(storageConfigSite.siteId, newTierName, parseInt(newTierCapacity, 10));
      // Refresh discovered tiers
      const discovered = await fetchDiscoveredStorage(storageConfigSite.siteId);
      setDiscoveredTiers(discovered.tiers);
      const configs = await fetchStorageConfig(storageConfigSite.siteId);
      setStorageConfigs(configs);
      setNewTierName('');
      setNewTierCapacity('');
      toast({
        title: 'Storage Tier Saved',
        description: `Usable capacity for ${newTierName} has been set to ${newTierCapacity} GB.`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSavingStorage(false);
    }
  };

  const handleSaveDiscoveredTierCapacity = async (tierName: string, capacity: string) => {
    if (!storageConfigSite || !capacity) return;
    
    setSavingStorage(true);
    try {
      await saveStorageConfig(storageConfigSite.siteId, tierName, parseInt(capacity, 10));
      // Refresh discovered tiers
      const discovered = await fetchDiscoveredStorage(storageConfigSite.siteId);
      setDiscoveredTiers(discovered.tiers);
      const configs = await fetchStorageConfig(storageConfigSite.siteId);
      setStorageConfigs(configs);
      setEditingTier(null);
      setEditingCapacity('');
      toast({
        title: 'Storage Capacity Saved',
        description: `Usable capacity for ${tierName} has been set to ${capacity} GB.`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSavingStorage(false);
    }
  };

  const handleCloseStorageConfig = () => {
    setStorageConfigSite(null);
    setStorageConfigs([]);
    setDiscoveredTiers([]);
    setPlatformConnected(false);
    setNewTierName('');
    setNewTierCapacity('');
    setEditingTier(null);
    setEditingCapacity('');
  };

  const renderCredentialFields = () => {
    switch (formData.platformType) {
      case 'vcd':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="administrator"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="********"
                  required={!editingSite}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org">Organization</Label>
              <Input
                id="org"
                data-testid="input-org"
                value={formData.org}
                onChange={(e) => setFormData({ ...formData, org: e.target.value })}
                placeholder="System"
                required
              />
            </div>
          </>
        );
      case 'cloudstack':
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                data-testid="input-apikey"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="Your CloudStack API key"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secretKey">Secret Key</Label>
              <Input
                id="secretKey"
                data-testid="input-secretkey"
                type="password"
                value={formData.secretKey}
                onChange={(e) => setFormData({ ...formData, secretKey: e.target.value })}
                placeholder="Your CloudStack secret key"
                required={!editingSite}
              />
            </div>
          </>
        );
      case 'proxmox':
        return (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  placeholder="root"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  data-testid="input-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="********"
                  required={!editingSite}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="realm">Realm</Label>
              <Select
                value={formData.realm}
                onValueChange={(value) => setFormData({ ...formData, realm: value })}
              >
                <SelectTrigger data-testid="select-realm">
                  <SelectValue placeholder="Select realm" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pam">PAM (Linux)</SelectItem>
                  <SelectItem value="pve">PVE (Proxmox)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        );
      default:
        return null;
    }
  };

  const dialogContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="siteId">Site ID</Label>
          <Input
            id="siteId"
            data-testid="input-siteid"
            value={formData.siteId}
            onChange={(e) => setFormData({ ...formData, siteId: e.target.value.toUpperCase() })}
            placeholder="ATL1"
            disabled={!!editingSite}
            required
          />
          <p className="text-xs text-muted-foreground">Unique identifier (e.g., ATL1, ORD2)</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="platformType">Platform Type</Label>
          <Select
            value={formData.platformType}
            onValueChange={(value: PlatformType) => setFormData({ ...formData, platformType: value })}
            disabled={!!editingSite}
          >
            <SelectTrigger data-testid="select-platform">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vcd">VMware Cloud Director</SelectItem>
              <SelectItem value="cloudstack">Apache CloudStack</SelectItem>
              <SelectItem value="proxmox">Proxmox VE</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Display Name</Label>
          <Input
            id="name"
            data-testid="input-name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Atlanta Datacenter 1"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="location">Location</Label>
          <Input
            id="location"
            data-testid="input-location"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            placeholder="Atlanta, GA"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="url">API URL</Label>
        <Input
          id="url"
          data-testid="input-url"
          value={formData.url}
          onChange={(e) => setFormData({ ...formData, url: e.target.value })}
          placeholder="https://vcd.example.com"
          required
        />
      </div>

      {renderCredentialFields()}

      {/* Management Links (VCD only) */}
      {formData.platformType === 'vcd' && (
        <div className="space-y-4 border-t pt-4">
          <p className="text-sm font-medium text-muted-foreground">Management Console Links (optional)</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vcenterUrl">vCenter URL</Label>
              <Input
                id="vcenterUrl"
                data-testid="input-vcenter-url"
                value={formData.vcenterUrl}
                onChange={(e) => setFormData({ ...formData, vcenterUrl: e.target.value })}
                placeholder="https://vcenter.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nsxUrl">NSX Manager URL</Label>
              <Input
                id="nsxUrl"
                data-testid="input-nsx-url"
                value={formData.nsxUrl}
                onChange={(e) => setFormData({ ...formData, nsxUrl: e.target.value })}
                placeholder="https://nsx.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ariaUrl">Aria Operations URL</Label>
              <Input
                id="ariaUrl"
                data-testid="input-aria-url"
                value={formData.ariaUrl}
                onChange={(e) => setFormData({ ...formData, ariaUrl: e.target.value })}
                placeholder="https://aria.example.com"
              />
            </div>
          </div>
          <p className="text-sm font-medium text-muted-foreground mt-4">vCenter Monitoring Credentials (optional)</p>
          <p className="text-xs text-muted-foreground">Used for health monitoring and alarm detection. Leave blank to skip vCenter checks.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vcenterUsername">vCenter Username</Label>
              <Input
                id="vcenterUsername"
                data-testid="input-vcenter-username"
                value={formData.vcenterUsername}
                onChange={(e) => setFormData({ ...formData, vcenterUsername: e.target.value })}
                placeholder="administrator@vsphere.local"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vcenterPassword">vCenter Password</Label>
              <Input
                id="vcenterPassword"
                data-testid="input-vcenter-password"
                type="password"
                value={formData.vcenterPassword}
                onChange={(e) => setFormData({ ...formData, vcenterPassword: e.target.value })}
                placeholder="********"
              />
            </div>
          </div>
        </div>
      )}

      {/* VSPC Integration (VCD only) */}
      {formData.platformType === 'vcd' && (
        <div className="space-y-4 border-t pt-4">
          <p className="text-sm font-medium text-muted-foreground">Veeam Service Provider Console (VSPC) Integration (optional)</p>
          <p className="text-xs text-muted-foreground">Connect to VSPC to retrieve backup metrics for organizations linked to this VCD site.</p>
          <div className="space-y-2">
            <Label htmlFor="vspcUrl">VSPC API URL</Label>
            <Input
              id="vspcUrl"
              data-testid="input-vspc-url"
              value={formData.vspcUrl}
              onChange={(e) => setFormData({ ...formData, vspcUrl: e.target.value })}
              placeholder="https://vspc.example.com:1280"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vspcUsername">VSPC Username</Label>
              <Input
                id="vspcUsername"
                data-testid="input-vspc-username"
                value={formData.vspcUsername}
                onChange={(e) => setFormData({ ...formData, vspcUsername: e.target.value })}
                placeholder="domain\\administrator"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vspcPassword">VSPC Password</Label>
              <Input
                id="vspcPassword"
                data-testid="input-vspc-password"
                type="password"
                value={formData.vspcPassword}
                onChange={(e) => setFormData({ ...formData, vspcPassword: e.target.value })}
                placeholder="********"
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center space-x-2">
        <Switch
          id="isEnabled"
          data-testid="switch-enabled"
          checked={formData.isEnabled}
          onCheckedChange={(checked) => setFormData({ ...formData, isEnabled: checked })}
        />
        <Label htmlFor="isEnabled">Enabled</Label>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={handleCloseDialog} data-testid="button-cancel">
          Cancel
        </Button>
        <Button 
          type="submit" 
          data-testid="button-save"
          disabled={createMutation.isPending || updateMutation.isPending}
        >
          {(createMutation.isPending || updateMutation.isPending) && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {editingSite ? 'Update' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Dashboard
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                <SettingsIcon className="h-6 w-6 text-primary" />
                <h1 className="text-2xl font-bold">Settings</h1>
              </div>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-site">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Platform Connection
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add Platform Connection</DialogTitle>
                  <DialogDescription>
                    Configure a new connection to a virtualization platform.
                  </DialogDescription>
                </DialogHeader>
                {dialogContent}
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Platform Connections</CardTitle>
            <CardDescription>
              Manage connections to VMware Cloud Director, Apache CloudStack, and Proxmox VE platforms.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : sites.length === 0 ? (
              <div className="text-center py-8">
                <Server className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Platform Connections</h3>
                <p className="text-muted-foreground mb-4">
                  Add a connection to start monitoring your virtualization platforms.
                </p>
                <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-first-site">
                  <Plus className="mr-2 h-4 w-4" />
                  Add First Connection
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {sites.map((site) => (
                  <div
                    key={site.id}
                    data-testid={`site-card-${site.siteId}`}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${getPlatformColor(site.platformType)}20`, color: getPlatformColor(site.platformType) }}
                      >
                        {getPlatformIcon(site.platformType)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium">{site.name}</h3>
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: `${getPlatformColor(site.platformType)}20`, color: getPlatformColor(site.platformType) }}
                          >
                            {getPlatformShortName(site.platformType)}
                          </span>
                          {site.isEnabled === false ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600">
                              Disabled
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600">
                              Enabled
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {site.location} &bull; {site.siteId}
                        </p>
                        <p className="text-xs text-muted-foreground truncate max-w-md">
                          {site.url}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(site.id)}
                        disabled={testingConnection === site.id}
                        data-testid={`button-test-${site.siteId}`}
                      >
                        {testingConnection === site.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <TestTube className="h-4 w-4" />
                        )}
                        <span className="ml-2">Test</span>
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenStorageConfig(site)}
                        data-testid={`button-storage-${site.siteId}`}
                        title="Configure Storage Capacity"
                      >
                        <HardDrive className="h-4 w-4" />
                      </Button>
                      
                      <Dialog open={editingSite?.id === site.id} onOpenChange={(open) => !open && handleCloseDialog()}>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(site)}
                            data-testid={`button-edit-${site.siteId}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>Edit Platform Connection</DialogTitle>
                            <DialogDescription>
                              Update the configuration for {site.name}.
                            </DialogDescription>
                          </DialogHeader>
                          {dialogContent}
                        </DialogContent>
                      </Dialog>
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            data-testid={`button-delete-${site.siteId}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Platform Connection</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete the connection to "{site.name}"? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(site.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              data-testid="button-confirm-delete"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Environment Variables</CardTitle>
            <CardDescription>
              Sites can also be configured via environment variables. These are read-only and cannot be managed through this interface.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted rounded-lg p-4 font-mono text-sm">
              <p className="text-muted-foreground mb-2"># VCD Configuration Example</p>
              <p>VCD_SITES=ATL1,ORD2</p>
              <p>VCD_ATL1_URL=https://vcd.example.com</p>
              <p>VCD_ATL1_USERNAME=administrator</p>
              <p>VCD_ATL1_PASSWORD=your-password</p>
              <p>VCD_ATL1_ORG=System</p>
              <p>VCD_ATL1_NAME=Atlanta DC</p>
              <p>VCD_ATL1_LOCATION=Atlanta, GA</p>
            </div>
          </CardContent>
        </Card>

        {/* Storage Configuration Dialog */}
        <Dialog open={!!storageConfigSite} onOpenChange={(open) => !open && handleCloseStorageConfig()}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Storage Capacity Configuration</DialogTitle>
              <DialogDescription>
                Set the usable storage capacity (in GB) for each storage tier in {storageConfigSite?.name}.
                {!platformConnected && !loadingDiscoveredTiers && (
                  <span className="text-yellow-600 ml-2">(Platform not connected - showing configured values only)</span>
                )}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {loadingDiscoveredTiers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span className="text-muted-foreground">Loading storage tiers from platform...</span>
                </div>
              ) : discoveredTiers.length > 0 ? (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Storage Tiers</Label>
                  <div className="space-y-2">
                    {discoveredTiers.map((tier) => (
                      <div key={tier.name} className="border rounded-lg p-3 bg-muted/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{tier.name}</span>
                          {tier.hasOverride && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                              Custom Capacity Set
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Platform Capacity:</span>
                            <p className="font-mono">{tier.discoveredCapacityGB.toLocaleString()} GB</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Used:</span>
                            <p className="font-mono">{tier.usedGB.toLocaleString()} GB</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Usable Capacity:</span>
                            {editingTier === tier.name ? (
                              <div className="flex items-center gap-2 mt-1">
                                <Input
                                  type="number"
                                  value={editingCapacity}
                                  onChange={(e) => setEditingCapacity(e.target.value)}
                                  className="h-8 w-24"
                                  placeholder="GB"
                                  data-testid={`input-capacity-${tier.name}`}
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => handleSaveDiscoveredTierCapacity(tier.name, editingCapacity)}
                                  disabled={savingStorage || !editingCapacity}
                                  data-testid={`button-save-capacity-${tier.name}`}
                                >
                                  {savingStorage ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8"
                                  onClick={() => { setEditingTier(null); setEditingCapacity(''); }}
                                  data-testid={`button-cancel-capacity-${tier.name}`}
                                >
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <p className="font-mono">
                                  {tier.configuredCapacityGB !== null 
                                    ? `${tier.configuredCapacityGB.toLocaleString()} GB` 
                                    : <span className="text-muted-foreground italic">Not set</span>}
                                </p>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2"
                                  onClick={() => { 
                                    setEditingTier(tier.name); 
                                    setEditingCapacity(tier.configuredCapacityGB?.toString() || tier.discoveredCapacityGB.toString()); 
                                  }}
                                  data-testid={`button-edit-capacity-${tier.name}`}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  No storage tiers discovered. Connect to the platform first or add a custom tier below.
                </div>
              )}
              
              {/* Add custom tier */}
              <div className="border-t pt-4">
                <Label className="text-sm font-medium">Add Custom Storage Tier</Label>
                <p className="text-xs text-muted-foreground mb-2">Add a tier that wasn't auto-discovered from the platform.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="tierName" className="text-xs text-muted-foreground">Tier Name</Label>
                    <Input
                      id="tierName"
                      data-testid="input-tier-name"
                      value={newTierName}
                      onChange={(e) => setNewTierName(e.target.value)}
                      placeholder="e.g., HPS, SPS, VVol"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tierCapacity" className="text-xs text-muted-foreground">Usable Capacity (GB)</Label>
                    <Input
                      id="tierCapacity"
                      data-testid="input-tier-capacity"
                      type="number"
                      value={newTierCapacity}
                      onChange={(e) => setNewTierCapacity(e.target.value)}
                      placeholder="e.g., 10000"
                    />
                  </div>
                </div>
                <Button 
                  onClick={handleSaveStorageTier} 
                  disabled={savingStorage || !newTierName || !newTierCapacity}
                  className="mt-2"
                  size="sm"
                  data-testid="button-save-storage"
                >
                  {savingStorage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Custom Tier
                </Button>
              </div>
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={handleCloseStorageConfig} data-testid="button-cancel-storage">
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
