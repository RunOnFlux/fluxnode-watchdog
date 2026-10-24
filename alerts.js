/**
 * Discord and Telegram alerts.
 *
 * The watchdog runs its checks and updates in one serial loop that waits for
 * every alert, so an alert must end in bounded time whatever the far end does:
 * each request is aborted after `ALERT_TIMEOUT_MS`, and a failure is the
 * caller's to log.
 */

const axios = require('axios');

const ALERT_TIMEOUT_MS = 15 * 1000;

function formatColor(color) {
  if (typeof color === 'string' && color.startsWith('#')) {
    return parseInt(color.slice(1), 16);
  }
  return Number(color);
}

/**
 * The webhook body for one Discord embed.
 * @param {{title: string, fields: Array<[string, string]>, color: string|number,
 *   thumbnailUrl: string, ping?: string}} message - `ping` is a Discord user id
 *   mentioned above the embed.
 * @returns {object}
 */
function discordPayload({ title, fields, color, thumbnailUrl, ping }) {
  const payload = {
    username: 'Flux Watchdog',
    embeds: [
      {
        title,
        fields: fields.map(([name, value]) => ({ name, value })),
        color: formatColor(color),
        thumbnail: { url: thumbnailUrl },
      },
    ],
  };
  if (ping) payload.content = `Ping: <@${ping}>`;
  return payload;
}

function post(url, body, timeoutMs) {
  return axios.post(url, body, { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) });
}

/**
 * Posts a Discord webhook message. Rejects on any non-2xx answer or after `timeoutMs`.
 * @param {string} webhookUrl
 * @param {object} payload - From `discordPayload`.
 * @param {{timeoutMs?: number}} [options]
 */
async function sendDiscord(webhookUrl, payload, { timeoutMs = ALERT_TIMEOUT_MS } = {}) {
  await post(webhookUrl, payload, timeoutMs);
}

/**
 * Sends a Telegram message as HTML. Rejects on any non-2xx answer or after `timeoutMs`.
 * @param {{apiBaseUrl?: string, token: string, chatId: string, text: string,
 *   timeoutMs?: number}} message
 */
async function sendTelegram({
  apiBaseUrl = 'https://api.telegram.org',
  token,
  chatId,
  text,
  timeoutMs = ALERT_TIMEOUT_MS,
}) {
  await post(
    `${apiBaseUrl}/bot${token}/sendMessage`,
    { chat_id: chatId, text, parse_mode: 'HTML' },
    timeoutMs,
  );
}

module.exports = { ALERT_TIMEOUT_MS, discordPayload, sendDiscord, sendTelegram };
