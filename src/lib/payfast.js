// PayFast (South Africa) helpers: checkout signing and ITN (webhook) verification.
// Docs: https://developers.payfast.co.za/docs
const crypto = require('crypto');
const dns = require('dns').promises;
const { config } = require('../config');

// PayFast signs with PHP urlencode() semantics: spaces as '+', everything except -_. percent-encoded, upper-case hex.
function pfEncode(value) {
  return encodeURIComponent(String(value).trim())
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// pairs: array of [key, value] in the order they are sent/received. Empty values are skipped.
function signature(pairs, passphrase) {
  let str = pairs
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([k, v]) => `${k}=${pfEncode(v)}`)
    .join('&');
  if (passphrase) str += `&passphrase=${pfEncode(passphrase)}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

const host = () => (config.payfast.sandbox ? 'sandbox.payfast.co.za' : 'www.payfast.co.za');

function amountString(cents) {
  return (cents / 100).toFixed(2);
}

// Builds the fields for a monthly recurring subscription checkout form.
function buildCheckout({ tenant, user, planKey }) {
  const plan = config.plans[planKey];
  const [first, ...rest] = String(user.name || '').split(' ');
  const pairs = [
    ['merchant_id', config.payfast.merchantId],
    ['merchant_key', config.payfast.merchantKey],
    ['return_url', `${config.appUrl}/?billing=success`],
    ['cancel_url', `${config.appUrl}/?billing=cancelled`],
    ['notify_url', `${config.appUrl}/api/billing/itn`],
    ['name_first', first],
    ['name_last', rest.join(' ')],
    ['email_address', user.email],
    ['m_payment_id', `t${tenant.id}-${planKey}-${Date.now()}`],
    ['amount', amountString(plan.priceCents)],
    ['item_name', `DiagnosticOS ${plan.name} (monthly)`],
    ['custom_str1', String(tenant.id)],
    ['custom_str2', planKey],
    ['subscription_type', '1'],
    ['billing_date', new Date().toISOString().slice(0, 10)],
    ['recurring_amount', amountString(plan.priceCents)],
    ['frequency', '3'],
    ['cycles', '0'],
  ];
  const fields = pairs.filter(([, v]) => v !== undefined && String(v) !== '');
  fields.push(['signature', signature(fields, config.payfast.passphrase)]);
  return { action: `https://${host()}/eng/process`, fields: Object.fromEntries(fields) };
}

// Validates an ITN. Returns { ok, reason, data }. `pairs` must be in received order.
async function verifyITN(pairs, sourceIp, { fetchImpl = fetch, skipNetwork = false, passphrase } = {}) {
  const data = Object.fromEntries(pairs);
  const given = data.signature;
  const body = pairs.filter(([k]) => k !== 'signature');
  const expected = signature(body, passphrase !== undefined ? passphrase : config.payfast.passphrase);
  if (!given || given.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return { ok: false, reason: 'bad signature' };
  }
  if (skipNetwork) return { ok: true, data };

  // 1) the request must come from PayFast
  const hosts = ['www.payfast.co.za', 'sandbox.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za'];
  try {
    const ips = (await Promise.all(hosts.map((h) => dns.resolve4(h).catch(() => [])))).flat();
    if (sourceIp && !ips.includes(String(sourceIp).replace('::ffff:', ''))) {
      return { ok: false, reason: 'source ip not payfast' };
    }
  } catch (_) { /* DNS failure: fall through to the server-to-server check below */ }

  // 2) PayFast confirms the data it sent
  const paramString = body.map(([k, v]) => `${k}=${pfEncode(v)}`).join('&');
  const resp = await fetchImpl(`https://${host()}/eng/query/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: paramString,
  });
  const text = (await resp.text()).trim();
  if (text !== 'VALID') return { ok: false, reason: 'payfast did not validate' };
  return { ok: true, data };
}

// Once-off payment for a customer's invoice, paid into the WORKSHOP's own PayFast account (not ours).
function buildInvoiceCheckout({ creds, invoice, customer, shopName }) {
  const pairs = [
    ['merchant_id', creds.merchantId], ['merchant_key', creds.merchantKey],
    ['return_url', `${config.appUrl}/pay.html#${invoice.pay_token}`], ['cancel_url', `${config.appUrl}/pay.html#${invoice.pay_token}`],
    ['notify_url', `${config.appUrl}/api/billing/itn`],
    ['name_first', customer ? customer.first_name : ''], ['name_last', customer ? customer.last_name : ''], ['email_address', customer ? customer.email : ''],
    ['m_payment_id', `inv${invoice.id}-${Date.now()}`], ['amount', amountString(invoice.total_cents)],
    ['item_name', `${shopName} invoice ${String(invoice.number).padStart(4, '0')}`.slice(0, 100)],
    ['custom_str1', 'inv'], ['custom_str2', invoice.pay_token],
  ];
  const fields = pairs.filter(([, v]) => v !== undefined && v !== null && String(v) !== '');
  fields.push(['signature', signature(fields, creds.passphrase)]);
  return { action: `https://${host()}/eng/process`, fields: Object.fromEntries(fields) };
}

module.exports = {
  buildInvoiceCheckout, signature, pfEncode, buildCheckout, verifyITN, amountString };
