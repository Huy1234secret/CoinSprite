const { SlashCommandBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { v2Payload, textContainer } = require('../shared/components');
const { assertValidMessagePayload } = require('../shared/discordPayload');
const { LotteryRepository, PRICE, TICKET_KEY } = require('../lottery/repository');
const { itemMetadata } = require('../inventory/itemCatalog');
const { WORK_EMOJIS } = require('../work/data/emojis');
const SHOP_COMMANDS = [{ data: new SlashCommandBuilder().setName('cs-shop').setDescription('Browse the shop and buy items') }];
let shopImage;
async function renderShop() {
  if (shopImage) return shopImage;
  const canvas = createCanvas(1080, 620), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#11151d'; ctx.fillRect(0, 0, 1080, 620);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 30px sans-serif'; ctx.fillText('COINSPRITE SHOP', 28, 45);
  let icon;
  try {
    const response = await fetch('https://cdn.discordapp.com/emojis/1546202786532818944.png', { signal: AbortSignal.timeout(3000) });
    if (response.ok) icon = await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch {}
  for (let i = 0; i < 6; i++) {
    const x = 24 + i % 3 * 352, y = 74 + Math.floor(i / 3) * 265;
    ctx.fillStyle = '#202735'; ctx.beginPath(); ctx.roundRect(x, y, 328, 245, 18); ctx.fill();
    if (i) { ctx.fillStyle = '#9aa4b6'; ctx.font = '22px sans-serif'; ctx.fillText('Coming soon', x + 90, y + 132); continue; }
    if (icon) ctx.drawImage(icon, x + 123, y + 18, 80, 80);
    else { ctx.fillStyle = '#f9d46a'; ctx.fillRect(x + 112, y + 32, 104, 56); ctx.fillStyle = '#443012'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('LOTTERY', x + 124, y + 65); }
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px sans-serif'; ctx.fillText('Lottery Ticket 1', x + 24, y + 133);
    ctx.fillStyle = '#f6cd78'; ctx.font = '22px sans-serif'; ctx.fillText('1,000 Bronze', x + 24, y + 173);
    ctx.fillStyle = '#b6c1d2'; ctx.font = '18px sans-serif'; ctx.fillText('Common · Useable', x + 24, y + 212);
  }
  shopImage = canvas.toBuffer('image/png'); return shopImage;
}
async function shopPayload() {
  const payload = v2Payload([{ type: 17, accent_color: 0xffffff, components: [
    { type: 12, items: [{ media: { url: 'attachment://shop.png' }, description: 'Shop: Lottery Ticket 1, Common, 1,000 Bronze; five coming-soon slots.' }] },
    { type: 10, content: '-# Tickets enter the next 20:00 UTC+7 draw. Up to 1,000 per purchase.' },
    { type: 1, components: [{ type: 3, custom_id: 'csshop:select', placeholder: 'Choose an item', options: [
      { label: 'Lottery Ticket 1', value: TICKET_KEY, emoji: { name: 'CSLotteryticket', id: '1546202786532818944' }, description: 'Stock: Unlimited' },
    ] }] },
  ] }]);
  payload.files = [{ attachment: await renderShop(), name: 'shop.png' }];
  return assertValidMessagePayload(payload);
}
function confirmation(order, balance) {
  const total = order.quantity * PRICE, missing = total > balance ? total - balance : 0n;
  return assertValidMessagePayload(v2Payload([{ type: 17, accent_color: missing ? 0xed4245 : 0x57f287, components: [
    { type: 10, content: `### <@${order.user_id}> You are buying ${order.quantity} Lottery Ticket 1\nFor ${total.toLocaleString('en-US')} ${WORK_EMOJIS.bronze}\n-# Confirm within 5 minutes. Balance is checked again when you buy.` },
    { type: 1, components: [{ type: 2, style: missing ? 4 : 3, custom_id: `csshop:buy:${order.id}`,
      label: missing ? `You don't have enough, you need ${missing.toLocaleString('en-US')} more` : 'Buy', disabled: Boolean(missing) }] },
  ] }]));
}
function createShopFeature(options) {
  const repository = new LotteryRepository(options.db, options);
  const allowed = source => !options.isCommandAllowed || options.isCommandAllowed(source.guildId, source.channelId, 'cs-shop');
  async function handleMessage(source) {
    if (!source.guildId || source.author?.bot || source.webhookId || source.system || !/^csshop$/i.test(String(source.content).trim())) return false;
    if (!allowed(source)) { await source.reply(textContainer('Shop is not enabled in this channel.')); return true; }
    await source.reply(await shopPayload()); return true;
  }
  async function handleInteraction(i) {
    const slash = i.isChatInputCommand?.() && i.commandName === 'cs-shop';
    if (!slash && !String(i.customId || '').startsWith('csshop:')) return false;
    if (!i.guildId || !i.user?.id) return false;
    if (!allowed(i)) { await i.reply(textContainer('Shop is not enabled in this channel.', { ephemeral: true })); return true; }
    if (slash) { await i.deferReply(); await i.editReply(await shopPayload()); return true; }
    if (i.isStringSelectMenu?.() && i.customId === 'csshop:select') {
      if (i.values?.[0] !== TICKET_KEY) return true;
      await i.showModal({ custom_id: 'csshop:quantity', title: 'Buy Lottery Ticket 1', components: [{ type: 1, components: [
        { type: 4, custom_id: 'quantity', label: 'How many Lottery Ticket 1 do you want to buy?', placeholder: 'Whole number: 1–1000', style: 1, required: true, min_length: 1, max_length: 4 },
      ] }] });
      // A fresh option list clears Discord's previous selection without replacing attachments.
      await i.message.edit({ components: (await shopPayload()).components }); return true;
    }
    if (i.isModalSubmit?.() && i.customId === 'csshop:quantity') {
      const input = i.fields.getTextInputValue('quantity').trim();
      if (!/^[1-9]\d{0,3}$/.test(input) || Number(input) > 1000) { await i.reply(textContainer('Enter a whole quantity from 1 to 1000.', { ephemeral: true })); return true; }
      const order = repository.createOrder(i.user.id, i.guildId, i.channelId, Number(input));
      await i.reply(confirmation(order, repository.balance(i.user.id))); return true;
    }
    if (i.isButton?.() && /^csshop:buy:[a-f0-9]{24}$/.test(i.customId)) {
      const id = i.customId.split(':')[2];
      const order = repository.order(id);
      if (!order || order.user_id !== i.user.id || order.guild_id !== i.guildId || order.channel_id !== i.channelId) {
        await i.reply(textContainer('This purchase belongs to another user or channel.', { ephemeral: true })); return true;
      }
      await i.deferUpdate();
      try {
        const result = repository.purchase(id, i.user.id, i.guildId, i.channelId);
        if (result.status === 'insufficient') await i.editReply(confirmation(order, repository.balance(i.user.id)));
        else await i.editReply(textContainer(`### Purchase complete\n<@${i.user.id}> bought **${result.quantity} ${itemMetadata(TICKET_KEY).name}**.\nCheck your codes in your website inventory.`, { color: 0x57f287, initial: false }));
      } catch (error) { await i.editReply(textContainer(error.message, { color: 0xed4245, initial: false })); }
      return true;
    }
    return false;
  }
  return { repository, handleMessage, handleInteraction };
}
module.exports = { SHOP_COMMANDS, createShopFeature, shopPayload, confirmation, renderShop };
