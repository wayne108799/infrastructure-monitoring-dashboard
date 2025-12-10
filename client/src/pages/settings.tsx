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
  fetchVeeamConfig,
  saveVeeamConfig,
  testVeeamConnection,
  type PlatformSiteConfig,
  type CreatePlatformSiteConfig,
  type PlatformType,
  type VeeamConfig
} from '@/lib/api';

function getPlatformIcon(type: PlatformType) {
  switch (type) {
    case 'vcd':
      return <Cloud className="h-5 w-5" />;
    case 'cloudstack':
      return <Server className="h-5 w-5" />;
    case 'proxmox':
      return <HardDrive className="h-5 w-5" />;
    case 'veeam':
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
};

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<PlatformSiteConfig | null>(null);
  const [formData, setFormData] = useState<SiteFormData>(initialFormData);
  const [testingConnection, setTestingConnection] = useState<string | null>(null);
  
  // Veeam config state
  const [veeamForm, setVeeamForm] = useState<VeeamConfig>({
    url: '',
    username: '',
    password: '',
    name: 'Veeam ONE',
    location: '',
    isEnabled: false,
  });
  const [testingVeeam, setTestingVeeam] = useState(false);
  const [savingVeeam, setSavingVeeam] = useState(false);

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['configuredSites'],
    queryFn: fetchConfiguredSites,
  });
  
  // Load Veeam config
  const { data: veeamConfig } = useQuery({
    queryKey: ['veeamConfig'],
    queryFn: fetchVeeamConfig,
  });
  
  // Update form when config loads
  useEffect(() => {
    if (veeamConfig) {
      setVeeamForm(veeamConfig);
    }
  }, [veeamConfig]);

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

    if (formData.platformType === 'vcd') {
      config.username = formData.username;
      config.password = formData.password;
      config.org = formData.org;
    } else if (formData.platformType === 'cloudstack') {
      config.apiKey = formData.apiKey;
      config.secretKey = formData.secretKey;
    } else if (formData.platformType === 'proxmox') {
      config.username = formData.username;
      config.password = formData.password;
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
    });
  };

  const handleCloseDialog = () => {
    setIsAddDialogOpen(false);
    setEditingSite(null);
    setFormData(initialFormData);
  };

  const handleSaveVeeamConfig = async () => {
    setSavingVeeam(true);
    try {
      await saveVeeamConfig(veeamForm);
      queryClient.invalidateQueries({ queryKey: ['veeamConfig'] });
      queryClient.invalidateQueries({ queryKey: ['veeamSummary'] });
      toast({
        title: 'Veeam Configuration Saved',
        description: 'The Veeam ONE configuration has been saved. Restart the server to apply changes.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSavingVeeam(false);
    }
  };

  const handleTestVeeamConnection = async () => {
    setTestingVeeam(true);
    try {
      const result = await testVeeamConnection({
        url: veeamForm.url,
        username: veeamForm.username,
        password: veeamForm.password,
      });
      if (result.success) {
        toast({
          title: 'Connection Successful',
          description: result.message || 'Successfully connected to Veeam ONE.',
        });
      } else {
        toast({
          title: 'Connection Failed',
          description: result.error || 'Could not connect to Veeam ONE.',
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
      setTestingVeeam(false);
    }
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="p-2 rounded-lg"
                  style={{ backgroundColor: '#00B33620', color: '#00B336' }}
                >
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>Veeam ONE Integration</CardTitle>
                  <CardDescription>
                    Monitor backup coverage across all VCD sites with a single Veeam ONE instance.
                  </CardDescription>
                </div>
              </div>
              {veeamForm.isEnabled && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600">
                  Enabled
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="veeam-url">API URL</Label>
                <Input
                  id="veeam-url"
                  data-testid="input-veeam-url"
                  value={veeamForm.url}
                  onChange={(e) => setVeeamForm({ ...veeamForm, url: e.target.value })}
                  placeholder="https://veeam-one.example.com:1239"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="veeam-name">Display Name</Label>
                <Input
                  id="veeam-name"
                  data-testid="input-veeam-name"
                  value={veeamForm.name}
                  onChange={(e) => setVeeamForm({ ...veeamForm, name: e.target.value })}
                  placeholder="Veeam ONE"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="veeam-username">Username</Label>
                <Input
                  id="veeam-username"
                  data-testid="input-veeam-username"
                  value={veeamForm.username}
                  onChange={(e) => setVeeamForm({ ...veeamForm, username: e.target.value })}
                  placeholder="administrator"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="veeam-password">Password</Label>
                <Input
                  id="veeam-password"
                  data-testid="input-veeam-password"
                  type="password"
                  value={veeamForm.password}
                  onChange={(e) => setVeeamForm({ ...veeamForm, password: e.target.value })}
                  placeholder="********"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="veeam-location">Location</Label>
              <Input
                id="veeam-location"
                data-testid="input-veeam-location"
                value={veeamForm.location}
                onChange={(e) => setVeeamForm({ ...veeamForm, location: e.target.value })}
                placeholder="US-East"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="veeam-enabled"
                data-testid="switch-veeam-enabled"
                checked={veeamForm.isEnabled}
                onCheckedChange={(checked) => setVeeamForm({ ...veeamForm, isEnabled: checked })}
              />
              <Label htmlFor="veeam-enabled">Enable Veeam ONE Integration</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Veeam ONE REST API runs on port 1239 by default. Include the port in your URL.
            </p>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={handleTestVeeamConnection}
                disabled={testingVeeam || !veeamForm.url || !veeamForm.username || !veeamForm.password}
                data-testid="button-test-veeam"
              >
                {testingVeeam ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TestTube className="mr-2 h-4 w-4" />
                )}
                Test Connection
              </Button>
              <Button
                onClick={handleSaveVeeamConfig}
                disabled={savingVeeam}
                data-testid="button-save-veeam"
              >
                {savingVeeam && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Configuration
              </Button>
            </div>
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
      </main>
    </div>
  );
}
