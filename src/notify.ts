import type { Env } from './types';

// Telegram HTML parse mode only reserves these three characters.
const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));

// Build a compact HTML message: a bold title, then "label: value" lines with
// empty values dropped so the alert stays short.
export function formatAlert(title: string, fields: Array<[string, unknown]>): string {
  const lines = fields
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `${escapeHtml(label)}: <b>${escapeHtml(value)}</b>`);
  return [`<b>${escapeHtml(title)}</b>`, ...lines].join('\n');
}

// Send a plain alert to the configured Telegram chat. Fire-and-forget: no-ops
// when unconfigured and never throws, so messaging problems can't affect (or
// slow, when run via ctx.waitUntil) a form submission.
export type NotificationDelivery = {
  status: 'SENT' | 'FAILED' | 'UNCONFIGURED';
  error: string | null;
};

export async function sendTelegram(env: Env, text: string): Promise<NotificationDelivery> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { status: 'UNCONFIGURED', error: 'Telegram belum dikonfigurasi.' };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      console.error('Telegram sendMessage failed:', response.status, detail);
      return { status: 'FAILED', error: `Telegram HTTP ${response.status}${detail ? `: ${detail}` : ''}` };
    }
    return { status: 'SENT', error: null };
  } catch (error) {
    console.error('Telegram notify error:', error);
    return { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 300) : 'Telegram gagal dikirim.' };
  }
}
