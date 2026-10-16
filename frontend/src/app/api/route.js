export { POST } from './webhooks/jubelio/invoice/route';

export async function GET() {
  return Response.json({
    name: 'Ansania Webhook & PWA Gateway',
    status: 'online',
    version: '2.0.0'
  });
}
