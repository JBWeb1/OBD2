(() => {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => 'R' + (c / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 });
  const token = location.hash.slice(1); const m = document.getElementById('m');
  fetch('/api/public/invoice/' + encodeURIComponent(token)).then(async (r) => { if (!r.ok) throw new Error('This payment link is not valid.'); return r.json(); }).then((i) => {
    m.innerHTML = `<h2>${esc(i.shop)}</h2><div class="muted">Invoice ${String(i.number).padStart(4, '0')}${i.due_on ? ' · due ' + esc(String(i.due_on).slice(0, 10)) : ''}</div>
      <table><tr><th>Description</th><th>Qty</th><th>Amount</th></tr>${i.items.map((x) => `<tr><td>${esc(x.description)}</td><td>${x.qty}</td><td>${money(x.qty * x.unit_cents)}</td></tr>`).join('')}</table>
      <h3 style="text-align:right">Total ${money(i.total_cents)}</h3>
      ${i.status === 'paid' ? '<p class="paid">✓ This invoice has been paid. Thank you!</p>' : i.canPay ? '<button id="pay">Pay securely with PayFast</button><p class="muted">You will be taken to PayFast to complete payment by card or instant EFT.</p>' : `<p class="muted">Online payment isn't available for this invoice. Please contact ${esc(i.shop)}${i.phone ? ' on ' + esc(i.phone) : ''}.</p>`}`;
    const b = document.getElementById('pay');
    if (b) b.onclick = async () => {
      b.disabled = true;
      try {
        const r = await fetch(`/api/public/invoice/${encodeURIComponent(token)}/checkout`, { method: 'POST' });
        const c = await r.json(); if (!r.ok) throw new Error(c.error);
        const f = document.createElement('form'); f.method = 'POST'; f.action = c.action;
        Object.entries(c.fields).forEach(([k, v]) => { const x = document.createElement('input'); x.type = 'hidden'; x.name = k; x.value = v; f.appendChild(x); });
        document.body.appendChild(f); f.submit();
      } catch (e) { alert(e.message); b.disabled = false; }
    };
  }).catch((e) => { m.textContent = e.message; });
})();
