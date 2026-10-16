import axios from 'axios';
import { config } from '../config.js';

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
      const response = await axios.post(`${config.jubelio.apiUrl}/login`, {
        email: config.jubelio.email,
        password: config.jubelio.password
      });

      if (response.data && response.data.token) {
        this.token = response.data.token;
        // Token valid for ~24 hours, setting refresh buffer
        this.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
        console.log('[Jubelio API] Login successful.');
        return this.token;
      } else {
        throw new Error('No token returned from Jubelio login API');
      }
    } catch (error) {
      console.error('[Jubelio API] Failed to log in to Jubelio API:', error.response?.data || error.message);
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

  /**
   * Fetch full sales invoice details by invoice ID
   */
  async getInvoiceDetails(invoiceId) {
    try {
      const token = await this.getToken();
      if (!token) {
        throw new Error('Jubelio API token unavailable');
      }

      console.log(`[Jubelio API] Fetching details for invoice ID ${invoiceId}...`);
      const response = await axios.get(`${config.jubelio.apiUrl}/sales/invoices/${invoiceId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      return response.data;
    } catch (error) {
      console.error(`[Jubelio API] Error fetching Jubelio invoice ${invoiceId}:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Fetch sales order details by sales order ID
   */
  async getSalesOrderDetails(salesOrderId) {
    try {
      const token = await this.getToken();
      if (!token) {
        throw new Error('Jubelio API token unavailable');
      }

      console.log(`[Jubelio API] Fetching details for sales order ID ${salesOrderId}...`);
      const response = await axios.get(`${config.jubelio.apiUrl}/sales/orders/${salesOrderId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      return response.data;
    } catch (error) {
      console.error(`[Jubelio API] Error fetching Jubelio Sales Order ${salesOrderId}:`, error.response?.data || error.message);
      throw error;
    }
  }
}

export const jubelioApiService = new JubelioApiService();
