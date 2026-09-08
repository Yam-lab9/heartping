// Existing module path retained. Firebase is not used; real traffic is same-origin.
export const backendService = {
  token: '',
  async request(endpoint, body) {
    let response;
    try {
      response = await fetch(`./api/${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', signal: AbortSignal.timeout(10000)
      });
    } catch { throw new Error('Cannot reach HeartPing. Check your connection and try again.'); }
    const data = await response.json().catch(() => ({ error: 'This copy has no HeartPing server. Use demo mode or open the hosted app.' }));
    if (!response.ok || data.error) throw Object.assign(new Error(data.error || 'Please try again.'), { status: response.status });
    return data;
  }
};
