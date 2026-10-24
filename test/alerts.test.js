const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { discordPayload, sendDiscord, sendTelegram } = require('../alerts');

// A local server; `answer(req, body, res)` decides the reply, or never replies.
async function serve(answer) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(body) });
      answer(res);
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => {
        server.close(resolve);
      });
    },
  };
}

const silent = () => {};

// How a send ended, or 'still waiting' if it had not after `ms`.
function settledWithin(send, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve('still waiting'), ms);
  });
  const outcome = send.then(
    () => 'sent',
    () => 'failed',
  );
  return Promise.race([outcome, deadline]).finally(() => clearTimeout(timer));
}

const noContent = (res) => {
  res.writeHead(204).end();
};

test('a Discord payload carries the embed, and a label and a ping when given', () => {
  assert.deepStrictEqual(
    discordPayload({
      title: ':loudspeaker: **FluxNode Alert**',
      fields: [
        ['URL:', 'http://1.2.3.4:16126'],
        ['Error:', 'fluxd down'],
      ],
      color: '#EA1414',
      thumbnailUrl: 'https://fluxnodeservice.com/images/error_icon.png',
    }),
    {
      username: 'Flux Watchdog',
      embeds: [
        {
          title: ':loudspeaker: **FluxNode Alert**',
          fields: [
            { name: 'URL:', value: 'http://1.2.3.4:16126' },
            { name: 'Error:', value: 'fluxd down' },
          ],
          color: 0xea1414,
          thumbnail: { url: 'https://fluxnodeservice.com/images/error_icon.png' },
        },
      ],
    },
  );
  const pinged = discordPayload({
    title: 't',
    fields: [['Name:', 'node1']],
    color: 3,
    thumbnailUrl: 'u',
    ping: '1234',
  });
  assert.strictEqual(pinged.content, 'Ping: <@1234>');
  assert.strictEqual(pinged.embeds[0].color, 3);
});

test('a Discord message is posted to the webhook', async () => {
  const server = await serve(noContent);
  try {
    const payload = discordPayload({ title: 't', fields: [], color: 1, thumbnailUrl: 'u' });
    await sendDiscord(`${server.url}/api/webhooks/1/abc`, payload);
    assert.deepStrictEqual(server.requests, [
      { method: 'POST', url: '/api/webhooks/1/abc', body: payload },
    ]);
  } finally {
    await server.close();
  }
});

test('a Discord webhook that refuses the message fails the send', async () => {
  const server = await serve((res) => res.writeHead(404).end());
  try {
    await assert.rejects(sendDiscord(server.url, {}));
  } finally {
    await server.close();
  }
});

test('a Telegram message is posted to the bot as HTML', async () => {
  const server = await serve((res) => res.writeHead(200).end('{"ok":true}'));
  try {
    await sendTelegram({ apiBaseUrl: server.url, token: 'T0K', chatId: '42', text: '<b>x</b>' });
    assert.deepStrictEqual(server.requests, [
      {
        method: 'POST',
        url: '/botT0K/sendMessage',
        body: { chat_id: '42', text: '<b>x</b>', parse_mode: 'HTML' },
      },
    ]);
  } finally {
    await server.close();
  }
});

test('a Discord webhook that never answers fails the send in time', async () => {
  const server = await serve(silent);
  try {
    const send = sendDiscord(server.url, {}, { timeoutMs: 200 });
    assert.strictEqual(await settledWithin(send, 2000), 'failed');
    assert.strictEqual(server.requests.length, 1);
  } finally {
    await server.close();
  }
});

test('a Telegram API that never answers fails the send in time', async () => {
  const server = await serve(silent);
  try {
    const send = sendTelegram({
      apiBaseUrl: server.url,
      token: 't',
      chatId: 'c',
      text: 'x',
      timeoutMs: 200,
    });
    assert.strictEqual(await settledWithin(send, 2000), 'failed');
    assert.strictEqual(server.requests.length, 1);
  } finally {
    await server.close();
  }
});
