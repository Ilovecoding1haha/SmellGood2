module.exports = async (req, res) => {
  const urls = (process.env.DISCORD_WEBHOOK_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  await Promise.all(urls.map(u => fetch(u, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeds: [{ title: '🔔 Webhook OK', color: 0x2e9e5b }] })
  }).catch(() => {})));
  res.json({ ok: true, webhooks: urls.length });
};
