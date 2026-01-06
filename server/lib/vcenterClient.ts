import https from 'https';

interface VCenterAlarm {
  entity: string;
  alarm: string;
  status: string;
  time: string;
}

interface VCenterSession {
  sessionId: string;
  baseUrl: string;
}

const agent = new https.Agent({
  rejectUnauthorized: false
});

async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    ...options,
    // @ts-ignore
    agent,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export async function createVCenterSession(baseUrl: string, username: string, password: string): Promise<VCenterSession> {
  const url = `${baseUrl}/api/session`;
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    // @ts-ignore
    agent,
  });
  
  if (!response.ok) {
    throw new Error(`vCenter auth failed: ${response.status} ${response.statusText}`);
  }
  
  const sessionId = await response.text();
  return { sessionId: sessionId.replace(/"/g, ''), baseUrl };
}

export async function destroyVCenterSession(session: VCenterSession): Promise<void> {
  try {
    await fetch(`${session.baseUrl}/api/session`, {
      method: 'DELETE',
      headers: {
        'vmware-api-session-id': session.sessionId,
      },
      // @ts-ignore
      agent,
    });
  } catch (e) {
    // Ignore errors during logout
  }
}

export async function getVCenterAlarms(session: VCenterSession): Promise<VCenterAlarm[]> {
  const url = `${session.baseUrl}/api/cis/tagging/tags`;
  
  try {
    // Try to get triggered alarms from the alarms API
    const alarmsUrl = `${session.baseUrl}/api/appliance/health/messages`;
    const response = await fetch(alarmsUrl, {
      headers: {
        'vmware-api-session-id': session.sessionId,
      },
      // @ts-ignore
      agent,
    });
    
    if (response.ok) {
      const messages = await response.json();
      return (messages || []).map((msg: any) => ({
        entity: msg.component || 'System',
        alarm: msg.message || 'Unknown alarm',
        status: msg.severity || 'warning',
        time: msg.time || new Date().toISOString(),
      }));
    }
    
    // Fallback: try to get cluster alarms via appliance API
    const applianceUrl = `${session.baseUrl}/api/appliance/health/applmgmt`;
    const applianceResponse = await fetch(applianceUrl, {
      headers: {
        'vmware-api-session-id': session.sessionId,
      },
      // @ts-ignore
      agent,
    });
    
    if (applianceResponse.ok) {
      const health = await applianceResponse.json();
      const alarms: VCenterAlarm[] = [];
      
      if (health && health !== 'green') {
        alarms.push({
          entity: 'vCenter Appliance',
          alarm: `Appliance health: ${health}`,
          status: health === 'red' ? 'critical' : 'warning',
          time: new Date().toISOString(),
        });
      }
      
      return alarms;
    }
    
    return [];
  } catch (error: any) {
    console.error('[vcenter-client] Error fetching alarms:', error.message);
    return [];
  }
}

export async function getVCenterTriggeredAlarms(baseUrl: string, username: string, password: string): Promise<{
  alarms: VCenterAlarm[];
  criticalCount: number;
  warningCount: number;
}> {
  let session: VCenterSession | null = null;
  
  try {
    session = await createVCenterSession(baseUrl, username, password);
    const alarms = await getVCenterAlarms(session);
    
    const criticalCount = alarms.filter(a => a.status === 'critical' || a.status === 'red').length;
    const warningCount = alarms.filter(a => a.status === 'warning' || a.status === 'yellow').length;
    
    return { alarms, criticalCount, warningCount };
  } finally {
    if (session) {
      await destroyVCenterSession(session);
    }
  }
}

export async function checkVCenterHealth(baseUrl: string): Promise<{ status: 'ok' | 'error'; responseTime: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    const url = `${baseUrl}/ui/login`;
    const response = await fetch(url, {
      method: 'HEAD',
      // @ts-ignore
      agent,
      signal: AbortSignal.timeout(10000),
    });
    
    const responseTime = Date.now() - startTime;
    
    if (response.ok || response.status === 302 || response.status === 200) {
      return { status: 'ok', responseTime };
    }
    
    return { status: 'error', responseTime, error: `HTTP ${response.status}` };
  } catch (error: any) {
    return { status: 'error', responseTime: Date.now() - startTime, error: error.message };
  }
}
