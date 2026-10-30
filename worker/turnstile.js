import { RoomError } from '../server/room-core.js';

export function turnstileConfig(env) {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_EXPECTED_HOSTNAME) {
    throw new RoomError('人机验证正在准备，请稍后再开房', 503);
  }
  return { required: true, siteKey: env.TURNSTILE_SITE_KEY };
}

export async function verifyTurnstile(env, token, identity, fetcher = fetch) {
  turnstileConfig(env);
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw new RoomError('请先完成人机验证', 403);
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  if (identity !== 'unknown') body.set('remoteip', identity);
  let value;
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Verification service unavailable');
    value = await response.json();
  } catch { throw new RoomError('验证服务暂时不可用，请稍后重试', 503); }
  if (value.success !== true || value.hostname !== env.TURNSTILE_EXPECTED_HOSTNAME || value.action !== 'patchwork_room') {
    throw new RoomError('人机验证未通过或已过期，请重新验证', 403);
  }
}
