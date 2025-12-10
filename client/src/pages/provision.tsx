import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, CheckCircle2, Loader2, Server, Building, HardDrive, Network, Shield } from 'lucide-react';
import { toast } from 'sonner';

interface ProvisionFormData {
  siteId: string;
  orgName: string;
  orgFullName: string;
  orgDescription: string;
  vdcName: string;
  allocationModel: string;
  cpuAllocatedMHz: number;
  cpuLimitMHz: number;
  memoryAllocatedMB: number;
  memoryLimitMB: number;
  storageProfileName: string;
  storageLimitMB: number;
  networkQuota: number;
  edgeGatewayName: string;
  externalNetworkId: string;
  primaryIpAddress: string;
  internalSubnet: string;
}

interface ProvisionStatus {
  step: string;
  progress: number;
  message: string;
  completed: boolean;
  error?: string;
  result?: {
    orgId?: string;
    vdcId?: string;
    edgeGatewayId?: string;
  };
}

interface Site {
  id: string;
  compositeId: string;
  name: string;
  location: string;
  platformType: string;
}

interface ExternalNetwork {
  id: string;
  name: string;
  subnets?: {
    values: Array<{
      gateway: string;
      prefixLength: number;
      ipRanges?: {
        values: Array<{
          startAddress: string;
          endAddress: string;
        }>;
      };
    }>;
  };
}

interface ProviderVdc {
  id: string;
  name: string;
  networkPools?: Array<{ id: string; name: string }>;
  storageProfiles?: Array<{ id: string; name: string }>;
}

export default function Provision() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ProvisionFormData>({
    siteId: '',
    orgName: '',
    orgFullName: '',
    orgDescription: '',
    vdcName: '',
    allocationModel: 'AllocationVApp',
    cpuAllocatedMHz: 10000,
    cpuLimitMHz: 10000,
    memoryAllocatedMB: 16384,
    memoryLimitMB: 16384,
    storageProfileName: '',
    storageLimitMB: 102400,
    networkQuota: 10,
    edgeGatewayName: '',
    externalNetworkId: '',
    primaryIpAddress: '',
    internalSubnet: '10.0.0.0/24',
  });

  const [provisionStatus, setProvisionStatus] = useState<ProvisionStatus | null>(null);

  const { data: sites, isLoading: sitesLoading } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: async () => {
      const res = await fetch('/api/sites');
      if (!res.ok) throw new Error('Failed to fetch sites');
      return res.json();
    },
  });

  const vcdSites = sites?.filter(s => s.platformType === 'vcd') || [];

  const { data: provisioningResources, isLoading: resourcesLoading } = useQuery({
    queryKey: ['provisioning-resources', formData.siteId],
    queryFn: async () => {
      if (!formData.siteId) return null;
      const res = await fetch(`/api/sites/${formData.siteId}/provisioning-resources`);
      if (!res.ok) throw new Error('Failed to fetch provisioning resources');
      return res.json();
    },
    enabled: !!formData.siteId,
  });

  const provisionMutation = useMutation({
    mutationFn: async (data: ProvisionFormData) => {
      setProvisionStatus({
        step: 'Starting',
        progress: 0,
        message: 'Initiating provisioning...',
        completed: false,
      });

      const res = await fetch(`/api/sites/${data.siteId}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Provisioning failed');
      }

      return res.json();
    },
    onSuccess: (result) => {
      setProvisionStatus({
        step: 'Complete',
        progress: 100,
        message: 'Provisioning completed successfully!',
        completed: true,
        result,
      });
      toast.success('VCD resources provisioned successfully');
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (error: Error) => {
      setProvisionStatus({
        step: 'Error',
        progress: 0,
        message: error.message,
        completed: false,
        error: error.message,
      });
      toast.error(`Provisioning failed: ${error.message}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.siteId || !formData.orgName || !formData.vdcName) {
      toast.error('Please fill in all required fields');
      return;
    }
    provisionMutation.mutate(formData);
  };

  const updateField = (field: keyof ProvisionFormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const selectedSite = vcdSites.find(s => s.compositeId === formData.siteId);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Provision New Customer
          </h1>
          <p className="text-muted-foreground mt-2">
            Auto-provision Organization, Org VDC, Edge Gateway, and default NAT rules in VMware Cloud Director
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Target VCD Site
              </CardTitle>
              <CardDescription>Select the VCD site where resources will be provisioned</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="site">VCD Site *</Label>
                  <Select
                    value={formData.siteId}
                    onValueChange={(value) => updateField('siteId', value)}
                  >
                    <SelectTrigger data-testid="select-site">
                      <SelectValue placeholder="Select a VCD site" />
                    </SelectTrigger>
                    <SelectContent>
                      {vcdSites.map((site) => (
                        <SelectItem key={site.compositeId} value={site.compositeId}>
                          {site.name} ({site.location})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Organization
              </CardTitle>
              <CardDescription>Configure the new organization details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name (Short) *</Label>
                  <Input
                    id="orgName"
                    value={formData.orgName}
                    onChange={(e) => updateField('orgName', e.target.value)}
                    placeholder="e.g., 12345"
                    data-testid="input-org-name"
                  />
                  <p className="text-xs text-muted-foreground">Used as the organization identifier</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orgFullName">Organization Full Name *</Label>
                  <Input
                    id="orgFullName"
                    value={formData.orgFullName}
                    onChange={(e) => updateField('orgFullName', e.target.value)}
                    placeholder="e.g., Acme Corporation"
                    data-testid="input-org-full-name"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="orgDescription">Description</Label>
                  <Textarea
                    id="orgDescription"
                    value={formData.orgDescription}
                    onChange={(e) => updateField('orgDescription', e.target.value)}
                    placeholder="Organization description"
                    data-testid="input-org-description"
                    rows={2}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Organization VDC
              </CardTitle>
              <CardDescription>Configure compute and storage resources</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vdcName">VDC Name *</Label>
                    <Input
                      id="vdcName"
                      value={formData.vdcName}
                      onChange={(e) => updateField('vdcName', e.target.value)}
                      placeholder="e.g., Production-VDC"
                      data-testid="input-vdc-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="allocationModel">Allocation Model</Label>
                    <Select
                      value={formData.allocationModel}
                      onValueChange={(value) => updateField('allocationModel', value)}
                    >
                      <SelectTrigger data-testid="select-allocation-model">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AllocationVApp">Allocation (Pay-As-You-Go)</SelectItem>
                        <SelectItem value="AllocationPool">Allocation Pool</SelectItem>
                        <SelectItem value="ReservationPool">Reservation Pool</SelectItem>
                        <SelectItem value="Flex">Flex</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-medium mb-3">Compute Resources</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="cpuAllocated">CPU Allocated (MHz)</Label>
                      <Input
                        id="cpuAllocated"
                        type="number"
                        value={formData.cpuAllocatedMHz}
                        onChange={(e) => updateField('cpuAllocatedMHz', parseInt(e.target.value) || 0)}
                        data-testid="input-cpu-allocated"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cpuLimit">CPU Limit (MHz)</Label>
                      <Input
                        id="cpuLimit"
                        type="number"
                        value={formData.cpuLimitMHz}
                        onChange={(e) => updateField('cpuLimitMHz', parseInt(e.target.value) || 0)}
                        data-testid="input-cpu-limit"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="memoryAllocated">Memory Allocated (MB)</Label>
                      <Input
                        id="memoryAllocated"
                        type="number"
                        value={formData.memoryAllocatedMB}
                        onChange={(e) => updateField('memoryAllocatedMB', parseInt(e.target.value) || 0)}
                        data-testid="input-memory-allocated"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="memoryLimit">Memory Limit (MB)</Label>
                      <Input
                        id="memoryLimit"
                        type="number"
                        value={formData.memoryLimitMB}
                        onChange={(e) => updateField('memoryLimitMB', parseInt(e.target.value) || 0)}
                        data-testid="input-memory-limit"
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-medium mb-3">Storage</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="storageProfile">Storage Profile</Label>
                      <Select
                        value={formData.storageProfileName}
                        onValueChange={(value) => updateField('storageProfileName', value)}
                      >
                        <SelectTrigger data-testid="select-storage-profile">
                          <SelectValue placeholder="Select storage profile" />
                        </SelectTrigger>
                        <SelectContent>
                          {provisioningResources?.storageProfiles?.map((profile: any) => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {profile.name}
                            </SelectItem>
                          )) || (
                            <SelectItem value="" disabled>
                              {resourcesLoading ? 'Loading...' : 'Select a site first'}
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="storageLimit">Storage Limit (MB)</Label>
                      <Input
                        id="storageLimit"
                        type="number"
                        value={formData.storageLimitMB}
                        onChange={(e) => updateField('storageLimitMB', parseInt(e.target.value) || 0)}
                        data-testid="input-storage-limit"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="networkQuota">Network Quota</Label>
                  <Input
                    id="networkQuota"
                    type="number"
                    value={formData.networkQuota}
                    onChange={(e) => updateField('networkQuota', parseInt(e.target.value) || 0)}
                    data-testid="input-network-quota"
                    className="max-w-xs"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" />
                Edge Gateway
              </CardTitle>
              <CardDescription>Configure NSX Edge Gateway for external connectivity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edgeGatewayName">Edge Gateway Name</Label>
                  <Input
                    id="edgeGatewayName"
                    value={formData.edgeGatewayName}
                    onChange={(e) => updateField('edgeGatewayName', e.target.value)}
                    placeholder="e.g., Customer-Edge-01"
                    data-testid="input-edge-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="externalNetwork">External Network</Label>
                  <Select
                    value={formData.externalNetworkId}
                    onValueChange={(value) => updateField('externalNetworkId', value)}
                  >
                    <SelectTrigger data-testid="select-external-network">
                      <SelectValue placeholder="Select external network" />
                    </SelectTrigger>
                    <SelectContent>
                      {provisioningResources?.externalNetworks?.map((network: ExternalNetwork) => (
                        <SelectItem key={network.id} value={network.id}>
                          {network.name}
                        </SelectItem>
                      )) || (
                        <SelectItem value="" disabled>
                          {resourcesLoading ? 'Loading...' : 'Select a site first'}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="primaryIp">Primary IP Address</Label>
                  <Input
                    id="primaryIp"
                    value={formData.primaryIpAddress}
                    onChange={(e) => updateField('primaryIpAddress', e.target.value)}
                    placeholder="Auto-assigned from pool if empty"
                    data-testid="input-primary-ip"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="internalSubnet">Internal Subnet (for SNAT)</Label>
                  <Input
                    id="internalSubnet"
                    value={formData.internalSubnet}
                    onChange={(e) => updateField('internalSubnet', e.target.value)}
                    placeholder="e.g., 10.0.0.0/24"
                    data-testid="input-internal-subnet"
                  />
                  <p className="text-xs text-muted-foreground">
                    Source subnet for outbound NAT rule
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Default NAT Rules
              </CardTitle>
              <CardDescription>Automatic SNAT rule for outbound internet access</CardDescription>
            </CardHeader>
            <CardContent>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Outbound SNAT Rule</AlertTitle>
                <AlertDescription>
                  An SNAT rule will be created to allow VMs in the internal subnet ({formData.internalSubnet || '10.0.0.0/24'}) 
                  to access the internet via the Edge Gateway's primary IP address.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {provisionStatus && (
            <Card className={provisionStatus.error ? 'border-destructive' : provisionStatus.completed ? 'border-green-500' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {provisionStatus.error ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : provisionStatus.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  )}
                  Provisioning Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={provisionStatus.progress} className="h-2" />
                <p className="text-sm">
                  <span className="font-medium">{provisionStatus.step}:</span> {provisionStatus.message}
                </p>
                {provisionStatus.result && (
                  <div className="text-sm space-y-1 font-mono bg-muted p-3 rounded">
                    {provisionStatus.result.orgId && <div>Organization ID: {provisionStatus.result.orgId}</div>}
                    {provisionStatus.result.vdcId && <div>VDC ID: {provisionStatus.result.vdcId}</div>}
                    {provisionStatus.result.edgeGatewayId && <div>Edge Gateway ID: {provisionStatus.result.edgeGatewayId}</div>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFormData({
                  siteId: '',
                  orgName: '',
                  orgFullName: '',
                  orgDescription: '',
                  vdcName: '',
                  allocationModel: 'AllocationVApp',
                  cpuAllocatedMHz: 10000,
                  cpuLimitMHz: 10000,
                  memoryAllocatedMB: 16384,
                  memoryLimitMB: 16384,
                  storageProfileName: '',
                  storageLimitMB: 102400,
                  networkQuota: 10,
                  edgeGatewayName: '',
                  externalNetworkId: '',
                  primaryIpAddress: '',
                  internalSubnet: '10.0.0.0/24',
                });
                setProvisionStatus(null);
              }}
              data-testid="button-reset"
            >
              Reset Form
            </Button>
            <Button
              type="submit"
              disabled={provisionMutation.isPending || !formData.siteId || !formData.orgName || !formData.vdcName}
              data-testid="button-provision"
            >
              {provisionMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Provisioning...
                </>
              ) : (
                'Provision Resources'
              )}
            </Button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
