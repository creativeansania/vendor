import { NextResponse } from 'next/server';
import { defaultOdooClient } from '@/lib/odoo/odooClient';
import { config } from '@/lib/config';

let cachedHealth = null;
let cachedAt = 0;
const HEALTH_TTL_MS = 30 * 1000; // 30 seconds

export async function GET() {
  const now = Date.now();
  if (cachedHealth && now - cachedAt < HEALTH_TTL_MS) {
    return NextResponse.json({
      ...cachedHealth,
      timestamp: new Date().toISOString(),
      cached: true
    });
  }

  let odooStatus = 'unknown';
  const companyName = config.odoo.companyName;
  let companyId = null;

  try {
    const uid = await defaultOdooClient.authenticate();
    companyId = await defaultOdooClient.getCompanyId();
    odooStatus = uid ? 'connected' : 'auth_failed';
  } catch (err) {
    odooStatus = `error: ${err.message}`;
  }

  cachedHealth = {
    status: 'online',
    service: 'Webhook Jubelio -> Odoo (Ansania) Fullstack Next.js',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'production',
    odoo: {
      url: config.odoo.url,
      db: config.odoo.db,
      status: odooStatus,
      targetCompany: companyName,
      companyId
    }
  };
  cachedAt = now;

  return NextResponse.json(cachedHealth);
}
