import axios from 'axios';
import crypto from 'crypto';

export async function getWebSessionCookie(client) {
  if (client.sessionCookie && client.sessionCookieExpires && Date.now() < client.sessionCookieExpires) {
    return client.sessionCookie;
  }

  const authUrl = `${client.url.replace(/\/+$/, '')}/web/session/authenticate`;
  const response = await axios.post(authUrl, {
    jsonrpc: '2.0',
    params: {
      db: client.db,
      login: client.username,
      password: client.password
    }
  });

  if (!response.data?.result?.uid) {
    throw new Error('Failed to authenticate web session with Odoo');
  }

  const cookies = response.headers['set-cookie'];
  if (!cookies || cookies.length === 0) {
    throw new Error('No session cookies returned by Odoo');
  }

  client.sessionCookie = cookies.map((c) => c.split(';')[0]).join('; ');
  client.sessionCookieExpires = Date.now() + 2 * 60 * 60 * 1000;
  return client.sessionCookie;
}

export async function getDocumentDetails(client, model, recordId) {
  if (!client.uid) await client.authenticate();

  const isInvoice = model === 'account.move';
  const fields = isInvoice
    ? ['id', 'name', 'state', 'partner_id', 'amount_total', 'currency_id', 'invoice_date', 'payment_state', 'access_token', 'access_url']
    : ['id', 'name', 'state', 'partner_id', 'amount_total', 'currency_id', 'date_order', 'access_token', 'access_url'];

  const records = await client._callObject(model, 'read', [[Number(recordId)]], { fields });
  if (!records || records.length === 0) {
    throw new Error(`Record ${model} with ID ${recordId} not found in Odoo`);
  }

  const doc = records[0];
  let partner = null;
  let phone = null;

  if (doc.partner_id && doc.partner_id[0]) {
    const partnerId = doc.partner_id[0];
    try {
      const partnerRecs = await client._callObject('res.partner', 'read', [[partnerId]], {
        fields: ['id', 'name', 'phone', 'phone_sanitized', 'email']
      });
      if (partnerRecs && partnerRecs.length > 0) {
        partner = partnerRecs[0];
        phone = partner.phone_sanitized || partner.phone || null;
      }
    } catch {}
  }

  return {
    id: doc.id,
    name: doc.name,
    model,
    state: doc.state,
    amountTotal: doc.amount_total,
    currency: Array.isArray(doc.currency_id) ? doc.currency_id[1] : 'IDR',
    date: isInvoice ? doc.invoice_date : doc.date_order,
    accessToken: doc.access_token,
    accessUrl: doc.access_url,
    partnerId: doc.partner_id ? doc.partner_id[0] : null,
    partnerName: partner?.name || (Array.isArray(doc.partner_id) ? doc.partner_id[1] : 'Pelanggan'),
    phone,
    rawDoc: doc,
    rawPartner: partner
  };
}

export async function getOrCreatePublicAttachment(client, model, recordId, buffer, filename) {
  if (!client.uid) await client.authenticate();

  const existing = await client._callObject('ir.attachment', 'search_read', [
    [['res_model', '=', model], ['res_id', '=', Number(recordId)], ['name', '=', filename]]
  ], { fields: ['id', 'access_token', 'name'], limit: 1 });

  let attachmentId = null;
  let accessToken = null;

  if (existing && existing.length > 0) {
    attachmentId = existing[0].id;
    accessToken = existing[0].access_token || crypto.randomUUID();
    await client._callObject('ir.attachment', 'write', [[attachmentId], {
      datas: buffer.toString('base64'),
      mimetype: 'application/pdf',
      access_token: accessToken,
      public: false
    }]);
  } else {
    accessToken = crypto.randomUUID();
    attachmentId = await client._callObject('ir.attachment', 'create', [{
      name: filename,
      type: 'binary',
      datas: buffer.toString('base64'),
      res_model: model,
      res_id: Number(recordId),
      mimetype: 'application/pdf',
      access_token: accessToken,
      public: false
    }]);
  }

  const publicUrl = `${client.url.replace(/\/+$/, '')}/web/content/${attachmentId}?download=true&access_token=${accessToken}`;
  return {
    attachmentId,
    accessToken,
    publicUrl
  };
}

export async function downloadDocumentPdf(client, model, recordId, customReportName = null) {
  const docInfo = await getDocumentDetails(client, model, recordId);

  let targetReport = customReportName;
  if (model === 'account.move') {
    if (!targetReport || targetReport === 'internal' || targetReport === 'invoice_internal') {
      targetReport = process.env.ODOO_INVOICE_REPORT || 'account.report_invoice_copy_3';
    } else if (targetReport === 'external_ppn') {
      targetReport = 'account.report_invoice_copy_1';
    } else if (targetReport === 'external_non_ppn') {
      targetReport = 'account.report_invoice_copy_2';
    } else if (targetReport === 'default') {
      targetReport = 'account.report_invoice_with_payments';
    }
  }

  if (targetReport) {
    try {
      const cookie = await getWebSessionCookie(client);
      const reportUrl = `${client.url.replace(/\/+$/, '')}/report/pdf/${targetReport}/${recordId}`;

      const response = await axios.get(reportUrl, {
        headers: { Cookie: cookie },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const filename = `${(docInfo.name || 'invoice').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
      const buffer = Buffer.from(response.data);

      let publicAttachmentUrl = null;
      try {
        const att = await getOrCreatePublicAttachment(client, model, recordId, buffer, filename);
        publicAttachmentUrl = att.publicUrl;
      } catch {}

      return {
        buffer,
        filename,
        docInfo,
        reportName: targetReport,
        publicAttachmentUrl
      };
    } catch {}
  }

  const { accessUrl, accessToken, name } = docInfo;
  if (!accessUrl || !accessToken) {
    throw new Error(`Document ${model} ID ${recordId} does not have portal access_token or access_url`);
  }

  const downloadUrl = `${client.url.replace(/\/+$/, '')}${accessUrl}?report_type=pdf&download=true&access_token=${accessToken}`;
  const response = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    timeout: 30000
  });

  const filename = `${(name || 'document').replace(/[/\\?%*:|"<>]/g, '_')}.pdf`;
  const buffer = Buffer.from(response.data);

  let publicAttachmentUrl = null;
  try {
    const att = await getOrCreatePublicAttachment(client, model, recordId, buffer, filename);
    publicAttachmentUrl = att.publicUrl;
  } catch {}

  return {
    buffer,
    filename,
    docInfo,
    reportName: 'portal_default',
    publicAttachmentUrl: publicAttachmentUrl || downloadUrl
  };
}

