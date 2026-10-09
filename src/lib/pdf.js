// Server-side PDFs (pdfkit). Amounts are stored as cents; prices are treated as VAT-inclusive when the shop has a VAT number.
const PDFDocument = require('pdfkit');

const money = (c) => 'R' + ((c || 0) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : '—');

function build(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    draw(doc); doc.end();
  });
}

function header(doc, shop, title, subtitle) {
  let x = 48;
  const m = shop.logo && /^data:image\/(png|jpeg);base64,(.+)$/.exec(shop.logo);
  if (m) { try { doc.image(Buffer.from(m[2], 'base64'), 48, 44, { fit: [90, 50] }); x = 150; } catch (_) { /* bad image: skip logo */ } }
  doc.fontSize(16).font('Helvetica-Bold').text(shop.name || '', x, 48);
  doc.fontSize(9).font('Helvetica').fillColor('#555');
  [shop.address, shop.phone, shop.email, shop.vat_number ? `VAT no. ${shop.vat_number}` : null].filter(Boolean).forEach((l) => doc.text(l, x));
  doc.fillColor('#000').fontSize(20).font('Helvetica-Bold').text(title, 350, 48, { width: 197, align: 'right' });
  doc.fontSize(10).font('Helvetica').fillColor('#555').text(subtitle, 350, 74, { width: 197, align: 'right' }).fillColor('#000');
  doc.moveTo(48, 118).lineTo(547, 118).strokeColor('#bbb').stroke().strokeColor('#000');
  doc.y = 130; doc.x = 48;
}

function invoicePdf({ shop, invoice, customer, vehicle, payUrl }) {
  const isQuote = invoice.kind === 'quote';
  const no = `${isQuote ? 'Q' : 'INV'}-${String(invoice.number).padStart(4, '0')}`;
  return build((doc) => {
    header(doc, shop, isQuote ? 'QUOTE' : 'INVOICE', `${no}\nIssued ${ymd(invoice.issued_on)}${invoice.due_on ? `\nDue ${ymd(invoice.due_on)}` : ''}`);
    doc.fontSize(10).font('Helvetica-Bold').text('Bill to'); doc.font('Helvetica');
    doc.text(customer ? `${customer.first_name} ${customer.last_name || ''}`.trim() : '—');
    if (customer && customer.email) doc.text(customer.email); if (customer && customer.phone) doc.text(customer.phone);
    if (vehicle) doc.moveDown(0.4).text(`Vehicle: ${vehicle.year || ''} ${vehicle.make} ${vehicle.model}${vehicle.plate ? ' · ' + vehicle.plate : ''}${vehicle.vin ? ' · VIN ' + vehicle.vin : ''}`);
    doc.moveDown();
    const y0 = doc.y; doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Description', 48, y0, { width: 260 }).text('Qty', 310, y0, { width: 40, align: 'right' }).text('Unit', 360, y0, { width: 80, align: 'right' }).text('Total', 450, y0, { width: 97, align: 'right' });
    doc.moveTo(48, y0 + 14).lineTo(547, y0 + 14).strokeColor('#bbb').stroke().strokeColor('#000'); doc.font('Helvetica').fontSize(10); doc.y = y0 + 20;
    for (const i of invoice.items || []) {
      if (doc.y > 720) { doc.addPage(); }
      const y = doc.y; const h = doc.heightOfString(i.description, { width: 260 });
      doc.text(i.description, 48, y, { width: 260 }).text(String(i.qty), 310, y, { width: 40, align: 'right' }).text(money(i.unit_cents), 360, y, { width: 80, align: 'right' }).text(money(i.qty * i.unit_cents), 450, y, { width: 97, align: 'right' });
      doc.y = y + Math.max(h, 14) + 4;
    }
    doc.moveTo(300, doc.y + 2).lineTo(547, doc.y + 2).strokeColor('#bbb').stroke().strokeColor('#000'); doc.y += 10;
    doc.font('Helvetica-Bold').fontSize(12).text(`Total ${money(invoice.total_cents)}`, 300, doc.y, { width: 247, align: 'right' });
    if (shop.vat_number) doc.font('Helvetica').fontSize(8).fillColor('#555').text(`Includes VAT at 15%: ${money(Math.round(invoice.total_cents * 15 / 115))}`, 300, doc.y + 2, { width: 247, align: 'right' }).fillColor('#000');
    doc.moveDown(2).font('Helvetica').fontSize(10);
    if (!isQuote && invoice.status === 'paid') doc.fillColor('#0a7a3f').font('Helvetica-Bold').text('PAID', 48).fillColor('#000').font('Helvetica');
    if (shop.bank_details && !isQuote && invoice.status !== 'paid') { doc.font('Helvetica-Bold').text('Banking details'); doc.font('Helvetica').text(shop.bank_details); doc.moveDown(0.5); }
    if (payUrl && !isQuote && invoice.status !== 'paid') { doc.font('Helvetica-Bold').text('Pay online'); doc.font('Helvetica').fillColor('#2563eb').text(payUrl, { link: payUrl }).fillColor('#000'); }
    if (isQuote) doc.fontSize(9).fillColor('#555').text('This quote is an estimate and is subject to confirmation after inspection.', 48, 760).fillColor('#000');
  });
}

function section(doc, title, heads, rows, widths) {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text(title).moveDown(0.2);
  if (!rows.length) { doc.font('Helvetica').fontSize(9).fillColor('#777').text('None recorded.').fillColor('#000'); return; }
  const draw = (cells, bold) => {
    const y = doc.y; let x = 48; doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c ?? ''), { width: widths[i] - 4 })));
    cells.forEach((c, i) => { doc.text(String(c ?? '—'), x, y, { width: widths[i] - 4 }); x += widths[i]; });
    doc.y = y + Math.max(h, 11) + 3;
  };
  draw(heads, true); rows.forEach((r) => { if (doc.y > 760) doc.addPage(); draw(r, false); });
}

function vehicleReportPdf({ shop, report }) {
  const { vehicle: v, customer, dtcs, remaps, inspections, invoices, scans } = report;
  return build((doc) => {
    header(doc, shop, 'VEHICLE REPORT', new Date().toISOString().slice(0, 10));
    doc.font('Helvetica-Bold').fontSize(13).text(`${v.year || ''} ${v.make} ${v.model}`.trim());
    doc.font('Helvetica').fontSize(9).fillColor('#444').text(`VIN ${v.vin || '—'}  ·  Plate ${v.plate || '—'}  ·  Engine ${v.engine || '—'}  ·  ${v.mileage_km != null ? v.mileage_km.toLocaleString('en-ZA') + ' km' : ''}`);
    doc.text(`Owner: ${customer ? `${customer.first_name} ${customer.last_name || ''}`.trim() : '—'}${v.next_service_on ? `  ·  Next service ${ymd(v.next_service_on)}` : ''}`).fillColor('#000');
    section(doc, 'Fault codes', ['Date', 'Code', 'Description', 'Status'], dtcs.map((d) => [ymd(d.created_at), d.code, d.info.name, d.status]), [70, 60, 280, 90]);
    section(doc, 'Remaps', ['Date', 'ECU', 'Stage', 'Power kW (before → after)'], remaps.map((m) => [ymd(m.done_on), m.ecu, m.stage, `${m.power_before_kw ?? '—'} → ${m.power_after_kw ?? '—'}`]), [70, 150, 100, 180]);
    section(doc, 'Inspections', ['Date', 'Type', 'Status'], inspections.map((i) => [ymd(i.created_at), i.type, i.status.replace('_', ' ')]), [90, 200, 210]);
    section(doc, 'Invoices', ['#', 'Date', 'Amount', 'Status'], invoices.map((i) => [i.number, ymd(i.issued_on), money(i.total_cents), i.status]), [60, 100, 120, 220]);
    section(doc, 'Scans', ['Date', 'Protocol', 'Source'], scans.map((s) => [ymd(s.started_at), s.protocol, s.source]), [100, 250, 150]);
    const tested = scans.find((s) => Array.isArray(s.monitor_tests) && s.monitor_tests.length);
    if (tested) {
      const failed = tested.monitor_tests.filter((t) => !t.pass);
      section(doc, `On-board monitor tests (Mode 06), ${ymd(tested.started_at)}: ${tested.monitor_tests.length - failed.length} of ${tested.monitor_tests.length} passed`,
        ['Monitor', 'Test', 'Result', 'Allowed range'], failed.map((t) => [t.monitor, `TID ${Number(t.tid).toString(16).toUpperCase()}`, `${t.value} ${t.unit || ''}`, `${t.min} – ${t.max}`]), [170, 70, 120, 140]);
    }
  });
}
module.exports = { invoicePdf, vehicleReportPdf, money };
