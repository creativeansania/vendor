import { config } from '../config.js';

async function wablasFetch(url, options = {}, timeoutMs = 20000) {
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
    throw new Error(`Wablas HTTP ${response.status}: ${detail}`);
  }

  return data;
}

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
    return wablasFetch(url, {}, 15000);
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

    const data = await wablasFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ phone, message })
      },
      20000
    );

    console.log(`[Wablas] Message sent to ${phone}:`, data);
    return data;
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

    const data = await wablasFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader
        },
        body: formData
      },
      30000
    );

    console.log(`[Wablas] Document successfully sent to ${phone}:`, data);
    return data;
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

    const data = await wablasFetch(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone,
          document: documentUrl,
          caption
        })
      },
      30000
    );

    console.log(`[Wablas] Document URL sent to ${phone}:`, data);
    return data;
  }
}

export const wablasService = new WablasService();
