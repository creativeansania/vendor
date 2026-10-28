import { OdooClient } from './odooXmlRpcClient.js';

export { OdooClient };

// Default instance (Ansania)
export const defaultOdooClient = new OdooClient();

// Dedicated Admin instance
export const adminOdooClient = new OdooClient({
  url: process.env.ODOO_URL || 'https://kanti-sehati-sukses.odoo.com',
  db: process.env.ODOO_DB || 'kanti-sehati-sukses',
  username: process.env.ODOO_ADMIN_USERNAME || '',
  password: process.env.ODOO_ADMIN_PASSWORD || ''
});
