import { config } from '../config.js';

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 20000) {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs)
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail = typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data || response.statusText);
    const error = new Error(`HTTP ${response.status}: ${detail}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

class JubelioApiService {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
  }

  /**
   * Login to Jubelio API to get bearer token
   */
  async login() {
    if (!config.jubelio.email || !config.jubelio.password) {
      console.warn('[Jubelio API] Jubelio email/password not configured. Skipping API login.');
      return null;
    }

    try {
      console.log('[Jubelio API] Logging in to Jubelio API...');
      const data = await fetchJsonWithTimeout(`${config.jubelio.apiUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: config.jubelio.email,
          password: config.jubelio.password
        })
      });

      if (data && data.token) {
        this.token = data.token;
        // Token valid for ~24 hours, setting refresh buffer
        this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
        console.log('[Jubelio API] Login successful.');
        return this.token;
      }
      throw new Error('No token returned from Jubelio login API');
    } catch (error) {
      console.error('[Jubelio API] Failed to log in to Jubelio API:', error.data || error.message);
      throw error;
    }
  }

  /**
   * Get active valid token
   */
  async getToken() {
    if (!this.token || !this.tokenExpiry || Date.now() >= this.tokenExpiry) {
      await this.login();
    }
    return this.token;
  }

  async _authorizedGet(path, label) {
    let token = await this.getToken();
    if (!token) {
      throw new Error('Jubelio API token unavailable');
    }

    try {
      return await fetchJsonWithTimeout(`${config.jubelio.apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      if (error.status === 401) {
        this.token = null;
        this.tokenExpiry = null;
        token = await this.getToken();
        return await fetchJsonWithTimeout(`${config.jubelio.apiUrl}${path}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      console.error(`[Jubelio API] Error fetching ${label}:`, error.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch full sales invoice details by invoice ID
   */
  async getInvoiceDetails(invoiceId) {
    console.log(`[Jubelio API] Fetching details for invoice ID ${invoiceId}...`);
    return this._authorizedGet(`/sales/invoices/${invoiceId}`, `Jubelio invoice ${invoiceId}`);
  }

  /**
   * Fetch sales order details by sales order ID
   */
  async getSalesOrderDetails(salesOrderId) {
    console.log(`[Jubelio API] Fetching details for sales order ID ${salesOrderId}...`);
    return this._authorizedGet(`/sales/orders/${salesOrderId}`, `Jubelio Sales Order ${salesOrderId}`);
  }
}

export const jubelioApiService = new JubelioApiService();
