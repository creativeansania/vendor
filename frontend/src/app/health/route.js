import { NextResponse } from 'next/server';
import { defaultOdooClient } from '@/lib/odoo/odooClient';
import { config } from '@/lib/config';

export async function GET() {
  let odooStatus = 'unknown';
  let companyName = config.odoo.companyName;
  let companyId = null;

  try {
    const uid = await defaultOdooClient.authenticate();
    companyId = await defaultOdooClient.getCompanyId();
    odooStatus = uid ? 'connected' : 'auth_failed';
  } catch (err) {
    odooStatus = `error: ${err.message}`;
  }

  return NextResponse.json({
    status: 'online',
    service: 'Webhook Jubelio -> Odoo (Ansania) Fullstack Next.js',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'production',
    odoo: {
      url: config.odoo.url,
      db: config.odoo.db,
      status: odooStatus,
      targetCompany: companyName,
      companyId: companyId
    }
  });
}
