import axios from 'axios';
import { config } from '../config.js';

export class WablasService {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.wablas.baseUrl;
    this.token = options.token || config.wablas.token;
    this.secretKey = options.secretKey || config.wablas.secretKey;
  }

  /**
   * Normalize Indonesian phone numbers to international 628... format
   */
  normalizePhone(rawPhone) {
    if (!rawPhone) return null;
    let cleaned = String(rawPhone).replace(/\D/g, '');

    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.slice(1);
    } else if (cleaned.startsWith('8')) {
      cleaned = '62' + cleaned;
    } else if (cleaned.startsWith('62')) {
      // already valid format
    } else if (cleaned.startsWith('+62')) {
      cleaned = cleaned.slice(1);
    }

    if (cleaned.length < 9 || cleaned.length > 16) {
      return null;
    }

    return cleaned;
  }

  /**
   * Get Authorization header value
   * If secretKey is present: 'TOKEN.SECRET_KEY'
   * Otherwise: 'TOKEN'
   */
  getAuthorizationHeader() {
    const token = this.token?.trim();
    const secretKey = this.secretKey?.trim();
    if (!token) return '';
    if (secretKey) {
      return `${token}.${secretKey}`;
    }
    return token;
  }

  /**
   * Check Device Info and connection status
   */
  async getDeviceInfo() {
    const url = `${this.baseUrl}/api/device/info?token=${encodeURIComponent(this.token)}`;
    const response = await axios.get(url);
    return response.data;
  }

  /**
   * Send WhatsApp text message
   */
  async sendMessage(rawPhone, message) {
    const phone = this.normalizePhone(rawPhone);
    if (!phone) {
      throw new Error(`Invalid recipient phone number: "${rawPhone}"`);
    }

    const authHeader = this.getAuthorizationHeader();
    if (!authHeader) {
      throw new Error('Wablas API token is not configured.');
    }

    const url = `${this.baseUrl}/api/send-message`;
    console.log(`[Wablas] Sending WhatsApp text message to ${phone}...`);

    const response = await axios.post(
      url,
      { phone, message },
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    console.log(`[Wablas] Message sent to ${phone}:`, response.data);
    return response.data;
  }

  /**
   * Send Document / PDF directly from Buffer via multipart/form-data
   */
  async sendDocumentFromLocal(rawPhone, fileBuffer, filename = 'document.pdf', caption = '') {
    const phone = this.normalizePhone(rawPhone);
    if (!phone) {
      throw new Error(`Invalid recipient phone number: "${rawPhone}"`);
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('PDF file buffer is empty');
    }

    const authHeader = this.getAuthorizationHeader();
    if (!authHeader) {
      throw new Error('Wablas API token is not configured.');
    }

    const url = `${this.baseUrl}/api/send-document-from-local`;
    console.log(`[Wablas] Sending document "${filename}" (${fileBuffer.length} bytes) to ${phone}...`);

    const formData = new FormData();
    formData.append('phone', phone);

    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    formData.append('file', blob, filename);

    if (caption) {
      formData.append('caption', caption);
    }

    const response = await axios.post(url, formData, {
      headers: {
        Authorization: authHeader
      },
      timeout: 30000
    });

    console.log(`[Wablas] Document successfully sent to ${phone}:`, response.data);
    return response.data;
  }

  /**
   * Send Document / PDF via URL
   */
  async sendDocument(rawPhone, documentUrl, caption = '') {
    const phone = this.normalizePhone(rawPhone);
    if (!phone) {
      throw new Error(`Invalid recipient phone number: "${rawPhone}"`);
    }

    const authHeader = this.getAuthorizationHeader();
    if (!authHeader) {
      throw new Error('Wablas API token is not configured.');
    }

    const url = `${this.baseUrl}/api/send-document`;
    console.log(`[Wablas] Sending document URL to ${phone}...`);

    const response = await axios.post(
      url,
      {
        phone,
        document: documentUrl,
        caption
      },
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log(`[Wablas] Document URL sent to ${phone}:`, response.data);
    return response.data;
  }
}

export const wablasService = new WablasService();
