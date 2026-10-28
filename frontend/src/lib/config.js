export const config = {
  baseUrl: (process.env.SERVER_BASE_URL || 'https://vendor.kantiss.com').replace(/\/+$/, ''),
  jubelio: {
    apiUrl: process.env.JUBELIO_API_URL || 'https://api2.jubelio.com',
    email: process.env.JUBELIO_EMAIL || '',
    password: process.env.JUBELIO_PASSWORD || '',
    webhookSecret: process.env.JUBELIO_WEBHOOK_SECRET || '',
  },
  odoo: {
    url: process.env.ODOO_URL || 'https://kanti-sehati-sukses.odoo.com',
    db: process.env.ODOO_DB || 'kanti-sehati-sukses',
    username: process.env.ODOO_USERNAME || '',
    password: process.env.ODOO_PASSWORD || '',
    companyName: process.env.ODOO_COMPANY_NAME || 'Ansania',
    jenisSO: process.env.ODOO_JENIS_SO || 'Penjualan Konsinyasi',
    warehouseName: process.env.ODOO_WAREHOUSE_NAME || 'Gudang Online',
    invoiceReport: process.env.ODOO_INVOICE_REPORT || 'account.report_invoice_copy_3',
  },
  settings: {
    autoConfirmSO: process.env.AUTO_CONFIRM_SO !== 'false',
    autoValidateDelivery: process.env.AUTO_VALIDATE_DELIVERY !== 'false',
    autoCreateInvoice: process.env.AUTO_CREATE_INVOICE !== 'false',
    autoPostInvoice: process.env.AUTO_POST_INVOICE !== 'false',
    fallbackCustomerName: process.env.FALLBACK_CUSTOMER_NAME || 'Pelanggan Jubelio',
    defaultPricelistId: process.env.DEFAULT_PRICELIST_ID ? parseInt(process.env.DEFAULT_PRICELIST_ID, 10) : null,
  },
  channels: {
    useChannelCustomer: process.env.USE_CHANNEL_CUSTOMER !== 'false',
    shopee: process.env.CHANNEL_CUSTOMER_SHOPEE || 'Shopee - Ansania',
    tokopedia: process.env.CHANNEL_CUSTOMER_TOKOPEDIA || 'Tokopedia - Ansania',
    tiktok: process.env.CHANNEL_CUSTOMER_TIKTOK || 'TikTok Shop - Ansania',
    blibli: process.env.CHANNEL_CUSTOMER_BLIBLI || 'Blibli - Ansania',
    lazada: process.env.CHANNEL_CUSTOMER_LAZADA || 'Lazada - Ansania',
    evermos: process.env.CHANNEL_CUSTOMER_EVERMOS || 'Evermos - Ansania',
    fallback: process.env.FALLBACK_CUSTOMER_NAME || 'Pelanggan Jubelio'
  },
  wablas: {
    baseUrl: (process.env.WABLAS_BASE_URL || 'https://bdg.wablas.com').replace(/\/+$/, ''),
    token: process.env.WABLAS_API_TOKEN || '',
    secretKey: process.env.WABLAS_SECRET_KEY || '',
  }
};
