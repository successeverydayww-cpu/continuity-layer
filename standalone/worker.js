// Continuity Layer — fully standalone backend (Cloudflare Worker + D1)
// Zero Base44 dependence. Free forever tier: 100k requests/day, D1 5GB.
// All acts mirror the original continuityAuth backend: otp, verify, save, load,
// sync, history, version, claim, claims (token-gated), interview, migrate (token-gated).
// Secrets live in Cloudflare env vars: BREVO_KEY (email), ADMIN_TK (maintenance token).

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const now = () => Date.now();

async function sendMail(KEY, to, subject, text) {
  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: 'Continuity Layer', email: 'successeverydayww@gmail.com' }, to: [{ email: to }], subject, textContent: text }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const db = env.DB; // D1 binding
    let body = {};
    try { body = await request.json(); } catch {}
    const act = String(body.act || '');

    // ---- otp ----
    if (act === 'otp') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return json({ err: 'valid email required' }, 400);
      const cutoff = now() - 30 * 60000;
      await db.prepare('DELETE FROM otps WHERE at < ?').bind(cutoff).run();
      const today = await db.prepare('SELECT COUNT(*) AS c FROM otps WHERE email = ? AND at > ?').bind(email, now() - 86400000).first();
      const count = (today && today.c) || 0;
      if (count >= 6) return json({ err: 'too many codes today — try later' }, 429);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await db.prepare('INSERT INTO otps (email, code, at, tries) VALUES (?, ?, ?, 0)').bind(email, code, now()).run();
      try { await sendMail(env.BREVO_KEY, email, 'Your Continuity Layer code', 'Your verification code is: ' + code + '\n\nIt expires in 10 minutes. If you did not request this, ignore this email.\n\n— The Continuity Layer'); }
      catch { return json({ err: 'email send failed' }, 502); }
      return json({ ok: true });
    }

    // ---- verify ----
    if (act === 'verify') {
      const email = String(body.email || '').trim().toLowerCase();
      const code = String(body.code || '').trim();
      const row = await db.prepare('SELECT rowid, code, tries, at FROM otps WHERE email = ? ORDER BY at DESC LIMIT 1').bind(email).first();
      if (!row || now() - row.at > 10 * 60000) return json({ err: 'code expired — request a new one' }, 400);
      if (row.tries > 5) { await db.prepare('DELETE FROM otps WHERE rowid = ?').bind(row.rowid).run(); return json({ err: 'too many attempts — request a new code' }, 401); }
      if (row.code !== code) { await db.prepare('UPDATE otps SET tries = tries + 1 WHERE rowid = ?').bind(row.rowid).run(); return json({ err: 'wrong code' }, 401); }
      await db.prepare('DELETE FROM otps WHERE rowid = ?').bind(row.rowid).run();
      const u = await db.prepare('SELECT tier FROM users WHERE email = ?').bind(email).first();
      if (!u) await db.prepare('INSERT INTO users (email, status, tier, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(email, 'verified', 'Free', now(), now()).run();
      else await db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE email = ?').bind('verified', now(), email).run();
      return json({ ok: true, email, tier: u ? u.tier : 'Free' });
    }

    // ---- save (auto-archives previous capsule to version history, last 3 kept) ----
    if (act === 'save') {
      const email = String(body.email || '').trim().toLowerCase();
      let capsule = body.capsule;
      if (typeof capsule === 'object') capsule = JSON.stringify(capsule);
      if (!capsule || String(capsule).length < 10) return json({ err: 'empty capsule' }, 400);
      if (String(capsule).length > 100000) return json({ err: 'capsule over 100,000 characters' }, 413);
      const u = await db.prepare('SELECT email, status, capsule FROM users WHERE email = ?').bind(email).first();
      if (!u || u.status !== 'verified') return json({ err: 'not verified' }, 401);
      const s = String(capsule);
      // archive previous
      let prev = u.capsule || '';
      if (prev.startsWith('CHUNKED:')) {
        const { results } = await db.prepare('SELECT v FROM settings WHERE k LIKE ? ORDER BY k ASC').bind('c:' + email + ':%').all();
        prev = (results || []).map(r => r.v).join('');
      }
      if (prev && prev.length > 50) {
        const { results: hrows } = await db.prepare("SELECT DISTINCT substr(k, instr(k || ':x', ':')) FROM settings WHERE k LIKE ?").bind('h:' + email + ':%').all();
        let hts = [];
        for (const r of hrows || []) { const m = String(r['substr(k, instr(k || \':x\', \':\'))'] || ''); const parts = m.split(':'); if (parts[1] && /^\d+$/.test(parts[1])) hts.push(parts[1]); }
        hts = [...new Set(hts)].sort();
        while (hts.length >= 3) {
          const oldTs = hts.shift();
          await db.prepare('DELETE FROM settings WHERE k LIKE ?').bind('h:' + email + ':' + oldTs + ':%').run();
        }
        const ts = String(now());
        const hparts = [];
        for (let i = 0; i < prev.length; i += 12000) hparts.push(prev.slice(i, i + 12000));
        for (let i = 0; i < hparts.length; i++) await db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').bind('h:' + email + ':' + ts + ':' + i, hparts[i]).run();
      }
      await db.prepare('DELETE FROM settings WHERE k LIKE ?').bind('c:' + email + ':%').run();
      if (s.length <= 30000) {
        await db.prepare('UPDATE users SET capsule = ?, updated_at = ? WHERE email = ?').bind(s, now(), email).run();
        return json({ ok: true, stored: 'field' });
      }
      const parts = [];
      for (let i = 0; i < s.length; i += 12000) parts.push(s.slice(i, i + 12000));
      for (let i = 0; i < parts.length; i++) await db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').bind('c:' + email + ':' + i, parts[i]).run();
      await db.prepare('UPDATE users SET capsule = ?, updated_at = ? WHERE email = ?').bind('CHUNKED:' + parts.length, now(), email).run();
      return json({ ok: true, stored: 'chunked' });
    }

    // ---- load ----
    if (act === 'load') {
      const email = String(body.email || '').trim().toLowerCase();
      const u = await db.prepare('SELECT status, tier, capsule, sync_request FROM users WHERE email = ?').bind(email).first();
      if (!u || u.status !== 'verified') return json({ err: 'not verified' }, 401);
      let cap = u.capsule || '';
      if (cap.startsWith('CHUNKED:')) {
        const { results } = await db.prepare('SELECT v FROM settings WHERE k LIKE ? ORDER BY k ASC').bind('c:' + email + ':%').all();
        cap = (results || []).map(r => r.v).join('');
      }
      return json({ ok: true, capsule: cap, tier: u.tier || 'Free', sync_request: u.sync_request || '' });
    }

    // ---- sync (Concierge AI merge upload) ----
    if (act === 'sync') {
      const email = String(body.email || '').trim().toLowerCase();
      const data = String(body.data || '');
      if (!data || data.length < 100) return json({ err: 'archive too small' }, 400);
      if (data.length > 100000) return json({ err: 'archive over 100,000 characters' }, 413);
      const u = await db.prepare('SELECT status, tier FROM users WHERE email = ?').bind(email).first();
      if (!u || u.status !== 'verified') return json({ err: 'not verified' }, 401);
      if (String(u.tier || 'Free') !== 'Concierge') return json({ err: 'AI sync-merge is a Concierge feature — upgrade in the Pricing tab to unlock it' }, 402);
      await db.prepare('DELETE FROM settings WHERE k LIKE ?').bind('s:' + email + ':%').run();
      const parts = [];
      for (let i = 0; i < data.length; i += 12000) parts.push(data.slice(i, i + 12000));
      for (let i = 0; i < parts.length; i++) await db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').bind('s:' + email + ':' + i, parts[i]).run();
      await db.prepare('UPDATE users SET sync_request = ?, updated_at = ? WHERE email = ?').bind(new Date().toISOString(), now(), email).run();
      return json({ ok: true, parts: parts.length });
    }

    // ---- history ----
    if (act === 'history') {
      const email = String(body.email || '').trim().toLowerCase();
      const u = await db.prepare('SELECT status FROM users WHERE email = ?').bind(email).first();
      if (!u || u.status !== 'verified') return json({ err: 'not verified' }, 401);
      const { results } = await db.prepare("SELECT k, LENGTH(v) len FROM settings WHERE k LIKE ? ORDER BY k DESC").bind('h:' + email + ':%').all();
      const byTs = {};
      for (const r of results || []) {
        const ts = String(r.k).split(':')[2];
        if (ts && /^\d+$/.test(ts)) byTs[ts] = (byTs[ts] || 0) + (r.len || 0);
      }
      const versions = Object.keys(byTs).sort((a, b) => parseInt(b, 10) - parseInt(a, 10)).map(ts => ({ ts, date: new Date(parseInt(ts, 10)).toISOString(), chars: byTs[ts] }));
      return json({ ok: true, versions });
    }

    // ---- version ----
    if (act === 'version') {
      const email = String(body.email || '').trim().toLowerCase();
      const ts = String(body.ts || '');
      if (!/^\d+$/.test(ts)) return json({ err: 'bad version' }, 400);
      const u = await db.prepare('SELECT status FROM users WHERE email = ?').bind(email).first();
      if (!u || u.status !== 'verified') return json({ err: 'not verified' }, 401);
      const { results } = await db.prepare('SELECT v FROM settings WHERE k LIKE ? ORDER BY k ASC').bind('h:' + email + ':' + ts + ':%').all();
      if (!results || !results.length) return json({ err: 'version not found' }, 404);
      return json({ ok: true, capsule: results.map(r => r.v).join('') });
    }

    // ---- claim (payment receipt, chunked into settings) ----
    if (act === 'claim') {
      const email = String(body.email || '').trim().toLowerCase();
      const plan = String(body.plan || ''), ref = String(body.ref || ''), name = String(body.name || '').slice(0, 120);
      let receipt = String(body.receipt || '');
      if (receipt.startsWith('data:image')) receipt = receipt.split(',')[1] || '';
      if (!plan || !ref || !name || !receipt) return json({ err: 'plan, reference, name and receipt required' }, 400);
      if (receipt.length > 90000) return json({ err: 'receipt image too large' }, 413);
      await db.prepare('DELETE FROM settings WHERE k LIKE ?').bind('r:' + email + ':%').run();
      const parts = [];
      for (let i = 0; i < receipt.length; i += 12000) parts.push(receipt.slice(i, i + 12000));
      for (let i = 0; i < parts.length; i++) await db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').bind('r:' + email + ':' + i, parts[i]).run();
      const claimObj = { plan, ref, at: new Date().toISOString() };
      await db.prepare('INSERT INTO users (email, status, tier, claim, name, receipt, notified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET claim = excluded.claim, name = excluded.name, receipt = excluded.receipt, notified = \'\', updated_at = excluded.updated_at').bind(email, 'pending', 'Free', JSON.stringify(claimObj), name, 'CHUNKED:' + parts.length, '', now(), now()).run();
      return json({ ok: true, ref });
    }

    // ---- claims (maintenance: list unnotified claims — token-gated) ----
    if (act === 'claims' || act === 'migrate' || act === 'activate' || act === 'syncpull') {
      if (String(body.tk || '') !== String(env.ADMIN_TK || 'clm-vault-2026')) return json({ err: 'forbidden' }, 403);
      if (act === 'claims') {
        const { results } = await db.prepare("SELECT email, name, claim, interview, tier, notified FROM users WHERE claim != '' AND notified = ''").all();
        const out = [];
        for (const u of results || []) {
          const { results: rrows } = await db.prepare('SELECT v FROM settings WHERE k LIKE ? ORDER BY k ASC').bind('r:' + u.email + ':%').all();
          out.push({ email: u.email, name: u.name, claim: u.claim, interview: u.interview || '', receipt: (rrows || []).map(r => r.v).join('') });
        }
        return json({ ok: true, claims: out });
      }
      if (act === 'activate') { // activate a paid tier: {email, tier}
        const email = String(body.email || '').trim().toLowerCase();
        const tier = String(body.tier || '');
        if (!email || !tier) return json({ err: 'email and tier required' }, 400);
        await db.prepare('UPDATE users SET tier = ?, notified = ?, updated_at = ? WHERE email = ?').bind(tier, new Date().toISOString(), now(), email).run();
        return json({ ok: true });
      }
      if (act === 'syncpull') { // agent reads pending sync archives: {email}
        const email = String(body.email || '').trim().toLowerCase();
        const u = await db.prepare('SELECT email, status, tier, capsule, sync_request FROM users WHERE email = ?').bind(email).first();
        if (!u) return json({ err: 'not found' }, 404);
        const { results } = await db.prepare('SELECT v FROM settings WHERE k LIKE ? ORDER BY k ASC').bind('s:' + email + ':%').all();
        return json({ ok: true, archive: (results || []).map(r => r.v).join(''), user: u });
      }
      if (act === 'migrate') { // bulk import from Base44: {users:[...], settings:[...]}
        let nu = 0, ns = 0;
        for (const u of (body.users || [])) {
          await db.prepare('INSERT INTO users (email, status, tier, capsule, claim, name, receipt, interview, notified, sync_request, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET status = excluded.status, tier = excluded.tier, capsule = excluded.capsule, claim = excluded.claim, name = excluded.name, receipt = excluded.receipt, interview = excluded.interview, notified = excluded.notified, sync_request = excluded.sync_request, updated_at = excluded.updated_at').bind(String(u.email || ''), String(u.status || 'pending'), String(u.tier || 'Free'), String(u.capsule || ''), String(u.claim || ''), String(u.name || ''), String(u.receipt || ''), String(u.interview || ''), String(u.notified || ''), String(u.sync_request || ''), now(), now()).run();
          nu++;
        }
        for (const r of (body.settings || [])) {
          await db.prepare('INSERT INTO settings (k, v) VALUES (?, ?)').bind(String(r.k || ''), String(r.v || '')).run();
          ns++;
        }
        return json({ ok: true, users: nu, settings: ns });
      }
    }

    // ---- interview ----
    if (act === 'interview') {
      const email = String(body.email || '').trim().toLowerCase();
      let answers = body.answers;
      if (typeof answers === 'object') answers = JSON.stringify(answers);
      if (!answers || String(answers).length < 10) return json({ err: 'answers required' }, 400);
      if (String(answers).length > 40000) return json({ err: 'answers too long' }, 413);
      const u = await db.prepare('SELECT status FROM users WHERE email = ?').bind(email).first();
      if (!u || u.status !== 'verified') return json({ err: 'not verified' }, 401);
      await db.prepare('UPDATE users SET interview = ?, updated_at = ? WHERE email = ?').bind(String(answers), now(), email).run();
      return json({ ok: true });
    }

    return json({ err: 'unknown act' }, 400);
  },
};
