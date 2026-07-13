const test = require('node:test');
const assert = require('node:assert/strict');

const command = require('../commands/stock-set-up');

async function executeWithEnv({ publicUrl, redirectUrl }) {
  const previousPublicUrl = process.env.PUBLIC_WEB_BASE_URL;
  const previousRedirectUrl = process.env.DISCORD_REDIRECT_URI;
  let reply;

  if (publicUrl === undefined) delete process.env.PUBLIC_WEB_BASE_URL;
  else process.env.PUBLIC_WEB_BASE_URL = publicUrl;

  if (redirectUrl === undefined) delete process.env.DISCORD_REDIRECT_URI;
  else process.env.DISCORD_REDIRECT_URI = redirectUrl;

  try {
    await command.execute({
      guildId: '123456789',
      async reply(payload) {
        reply = payload;
      },
    });
  } finally {
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_WEB_BASE_URL;
    else process.env.PUBLIC_WEB_BASE_URL = previousPublicUrl;

    if (previousRedirectUrl === undefined) delete process.env.DISCORD_REDIRECT_URI;
    else process.env.DISCORD_REDIRECT_URI = previousRedirectUrl;
  }

  return reply;
}

test('/stock-set-up uses the public HTTPS dashboard URL', async () => {
  const reply = await executeWithEnv({
    publicUrl: 'https://panel.coin-sprite.com/',
  });

  assert.match(reply.content, /Dashboard: https:\/\/panel\.coin-sprite\.com\/admin/);
});

test('/stock-set-up defaults to the production HTTPS dashboard', async () => {
  const reply = await executeWithEnv({});

  assert.match(reply.content, /Dashboard: https:\/\/panel\.coin-sprite\.com\/admin/);
});
