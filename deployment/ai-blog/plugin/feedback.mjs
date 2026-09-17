import {createHash} from 'node:crypto';

// Acknowledgements are transport feedback, never model input or publication authority.
// Fail closed outside the explicitly allowed Feishu direct conversation.
export function registerFeedback(api, {fetchImpl = globalThis.fetch, now = Date.now} = {}) {
  const seen = new Map();
  let token;
  let tokenUntil = 0;
  api.on('message_received', async (event, ctx) => {
    const cfg = api.config?.channels?.feishu;
    const account = cfg?.accounts?.[ctx.accountId ?? 'main'];
    const sender = ctx.senderId ?? event.senderId;
    const id = ctx.messageId ?? event.messageId;
    const allowed = account?.allowFrom ?? cfg?.allowFrom ?? [];
    if (ctx.channelId !== 'feishu' || (ctx.accountId && ctx.accountId !== 'main')
        || !cfg?.enabled || (account?.dmPolicy ?? cfg.dmPolicy) !== 'allowlist'
        || !/^ou_[A-Za-z0-9]+$/.test(sender ?? '') || !allowed.includes(sender)
        || event.from !== `feishu:${sender}` || event.metadata?.to !== `user:${sender}`
        || !/^om_[A-Za-z0-9]+$/.test(id ?? '')
        || /^\s*\//.test(event.content ?? '')) return;
    const stamp = now();
    for (const [key, expiry] of seen) if (expiry <= stamp) seen.delete(key);
    const uuid = createHash('sha256').update(`cjw-ack-v1:${ctx.accountId ?? 'main'}:${id}`).digest('hex').slice(0, 48);
    if (seen.has(uuid)) return;
    seen.set(uuid, stamp + 86400000);
    if (seen.size > 4096) seen.delete(seen.keys().next().value);
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) return;
    const signal = AbortSignal.timeout(5000);
    try {
      if (!token || tokenUntil <= stamp) {
        const r = await fetchImpl('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({app_id: appId, app_secret: appSecret}), signal,
        });
        const data = await r.json();
        if (!r.ok || data.code !== 0 || !data.tenant_access_token) throw new Error('auth');
        token = data.tenant_access_token;
        tokenUntil = stamp + Math.max(0, (Number(data.expire) - 60) * 1000);
      }
      const response = await fetchImpl('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
        method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
        body: JSON.stringify({receive_id: sender, msg_type: 'text', uuid,
          content: JSON.stringify({text: '✅ 已收到，接下来处理。回复会逐步显示。'})}), signal,
      });
      const data = await response.json();
      if (!response.ok || data.code !== 0) throw new Error('send');
      api.logger?.info?.('[cjw-feedback] acknowledgement delivered');
    } catch {
      // Never delay/fail the main turn or leak credentials/API bodies into logs.
      api.logger?.warn?.('[cjw-feedback] acknowledgement unavailable; main reply continues');
    }
  });
  api.logger?.info?.('[cjw-feedback] receipt hook registered');
}
