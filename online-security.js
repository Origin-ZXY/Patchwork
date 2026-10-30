let sdk;
function loadSDK() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=patchworkTurnstileReady'; script.async = true;
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => { clearTimeout(timer); script.remove(); sdk = null; reject(new Error('无法载入人机验证，请检查网络后重新打开联机')); };
    script.onerror = fail;
    window.patchworkTurnstileReady = () => { clearTimeout(timer); if (window.turnstile) resolve(window.turnstile); else fail(); };
    document.head.append(script);
  });
  return sdk;
}

/** Tokens stay in memory and are consumed once by create/join. */
export class RoomVerification {
  constructor(container, onChange) { this.container = container; this.onChange = onChange; this.required = true; this.token = ''; this.active = true; this.widget = null; }
  get ready() { return this.active && (!this.required || Boolean(this.token)); }
  update(message) { if (this.active) this.onChange(this.ready, message); }
  async mount() {
    this.update('正在载入人机验证…');
    try {
      const response = await fetch('/api/security', { signal: AbortSignal.timeout(15000) });
      const config = await response.json();
      if (!response.ok) throw new Error(config.message || '暂时无法载入人机验证');
      if (!this.active) return;
      this.required = config.required !== false;
      if (!this.required) { this.update('本地联机已就绪'); return; }
      if (!config.siteKey) throw new Error('人机验证尚未配置，请稍后再试');
      const api = await loadSDK(); if (!this.active) return;
      this.api = api;
      this.widget = api.render(this.container, {
        sitekey: config.siteKey, action: 'patchwork_room', theme: 'dark', size: 'flexible', language: 'zh-cn', 'response-field': false,
        callback: token => { if (this.active) { this.token = token; this.update('验证通过，可以创建或加入房间'); } },
        'expired-callback': () => { this.token = ''; this.update('验证已过期，请重新验证'); },
        'error-callback': () => { this.token = ''; this.update('验证未完成，请检查网络或重新打开联机'); },
      });
    } catch (error) { this.update(error.message); }
  }
  take() {
    if (!this.ready) throw new Error('请先完成人机验证');
    const token = this.token; this.token = ''; this.update('正在提交…'); return token || undefined;
  }
  reset() { if (!this.active) return; this.token = ''; if (this.widget !== null) this.api.reset(this.widget); this.update(this.required ? '请重新完成人机验证' : '本地联机已就绪'); }
  destroy() { this.active = false; this.token = ''; if (this.widget !== null) this.api.remove(this.widget); }
}
