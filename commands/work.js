const fs = require('fs');
const path = require('path');
const { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { addBalance, recordGamblingEarnings, getWorkCooldown, setWorkCooldown } = require('../src/gamblingStore');
const { getUserProgress, addUserXp } = require('../src/levelingManager');
const { PRCOIN, formatNumber, formatAbbreviated } = require('../src/gamblingConfig');
const { JOBS } = require('../src/workJobs');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WORK_COOLDOWN_MS = 5 * 60 * 1000;
const STORE_PATH = path.join(__dirname, '..', 'data', 'work-jobs.json');
const JOBS_PER_PAGE = 5;
const YES = '<:Y_:1498173245981986869>';
const NO = '<:N_:1498173244031631400>';
const MEMORY_EMOJIS = ['🍎', '🍋', '🍇', '🍓', '🍒', '🥝', '🥥', '🍔'];
const activeSessions = new Map();

function ensureStore() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify({ users: {} }, null, 2), 'utf8'); }
function loadState() { ensureStore(); try { const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); state.users = state.users && typeof state.users === 'object' ? state.users : {}; return state; } catch { return { users: {} }; } }
function saveState(state) { ensureStore(); fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8'); }
function getUserRecord(state, userId) { if (!state.users[userId]) state.users[userId] = { jobId: null, totalWorks: 0, daily: {} }; const user = state.users[userId]; user.jobId = typeof user.jobId === 'string' ? user.jobId : null; user.totalWorks = Math.max(0, Math.floor(Number(user.totalWorks) || 0)); user.daily = user.daily && typeof user.daily === 'object' ? user.daily : {}; return user; }
function profile(userId) { const state = loadState(); return JSON.parse(JSON.stringify(getUserRecord(state, userId))); }
function setJob(userId, jobId) { const state = loadState(); getUserRecord(state, userId).jobId = jobId; saveState(state); }
function recordWork(userId) { const state = loadState(); const user = getUserRecord(state, userId); const now = new Date(); const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`; user.totalWorks += 1; user.daily[key] = Math.max(0, Math.floor(Number(user.daily[key]) || 0)) + 1; saveState(state); }

function getJob(jobId) { return JOBS.find((job) => job.id === jobId) || null; }
function userLevel(interaction) { return interaction.guildId ? getUserProgress(interaction.guildId, interaction.user.id).level : 1; }
function eligibility(interaction, job) { const p = profile(interaction.user.id); return { missingWorks: Math.max(0, job.requiredWorks - p.totalWorks), missingLevel: Math.max(0, job.requiredLevel - userLevel(interaction)) }; }
function canApply(interaction, job) { const e = eligibility(interaction, job); return e.missingWorks <= 0 && e.missingLevel <= 0; }
function range(job) { return `${formatNumber(job.min)}-${formatNumber(job.max)} ${PRCOIN}`; }
function xpRange(job) { return `${formatNumber(job.minXp)}-${formatNumber(job.maxXp)} XP`; }
function avg(job) { return Math.round((job.min + job.max) / 2); }
function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(items) { return items[Math.floor(Math.random() * items.length)]; }
function sid() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
function code() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 10 }, () => a[Math.floor(Math.random() * a.length)]).join(''); }
function mathProblem() { const a = ri(8, 49); const b = ri(3, 28); const op = pick(['+', '-', '*']); if (op === '+') return { q: `${a} + ${b}`, a: String(a + b) }; if (op === '-') return { q: `${a} - ${b}`, a: String(a - b) }; return { q: `${a} × ${b}`, a: String(a * b) }; }
function shuffle(items) { const out = [...items]; for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }

function text(content) { return { type: 10, content }; }
function section(content, accessory) { return { type: 9, components: [text(content)], accessory }; }
function sep() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function payload(components) { return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: 0xffffff, components }] }; }

function home(interaction, notice = '') {
  const p = profile(interaction.user.id); const job = getJob(p.jobId); const cd = getWorkCooldown(interaction.user.id);
  const cdMessage = !job ? 'GET a **Job** first' : cd > Date.now() ? `You can work again <t:${Math.floor(cd / 1000)}:R>` : 'Press **Work** to work';
  const jobLine = job ? `${job.name} // ${range(job)}` : `No job // 0 ${PRCOIN}`;
  const lines = [`## ${interaction.user} are you ready to work?`, `-# ${cdMessage}`, `-# Job: ${jobLine}`];
  if (notice) lines.push(notice);
  return payload([text(lines.join('\n')), sep(), row(button(`work:start:${interaction.user.id}`, 'Work', job && cd <= Date.now() ? 3 : 2, !job || cd > Date.now()), button(`work:jobs:${interaction.user.id}:0`, 'Change Job', 2))]);
}

function requirementText(interaction, job) {
  const e = eligibility(interaction, job); const parts = [];
  if (e.missingWorks > 0) parts.push(`work ${e.missingWorks} more`);
  if (e.missingLevel > 0) parts.push(`reach level ${job.requiredLevel}`);
  return `-# You need to ${parts.join(' and ')} to apply!`;
}
function jobsPage(interaction, page = 0) {
  const p = profile(interaction.user.id); const maxPage = Math.max(1, Math.ceil(JOBS.length / JOBS_PER_PAGE)); const safePage = ((Math.floor(Number(page) || 0) % maxPage) + maxPage) % maxPage;
  const components = [text(`## ${interaction.user} Choose a job!\n-# Page ${safePage + 1}/${maxPage}`)];
  for (const job of JOBS.slice(safePage * JOBS_PER_PAGE, (safePage * JOBS_PER_PAGE) + JOBS_PER_PAGE)) {
    const applied = p.jobId === job.id; const ok = canApply(interaction, job);
    const jobContent = ok
      ? [`### #${job.rank} ${job.name}`, `-# * Wage: ${formatNumber(avg(job))} ${PRCOIN} / work`, `-# * XP: ${xpRange(job)} / work`].join('\n')
      : `### #${job.rank} ${job.name}\n${requirementText(interaction, job)}`;
    components.push(section(jobContent, button(`work:apply:${interaction.user.id}:${job.id}:${safePage}`, applied ? 'Applied' : ok ? 'Apply' : 'Not Eligible', applied ? 2 : ok ? 3 : 4, applied || !ok)));
  }
  components.push(sep(), row(button(`work:jobpage:${interaction.user.id}:${safePage + 1}`, 'Switch page', 2, maxPage <= 1), button(`work:back:${interaction.user.id}`, 'Back', 2)));
  return payload(components);
}

function header(interaction, session, line) { return [`## ${interaction.user} are you ready to work?`, `-# You have <t:${Math.floor(session.expiresAt / 1000)}:R> to complete.`, `-# Job: ${session.job.name} // ${range(session.job)}`, line].join('\n'); }
function typingPayload(interaction, session) { return payload([text(header(interaction, session, `Type this code exactly: **${session.code}**`)), sep(), row(button(`work:type:${interaction.user.id}:${session.id}`, 'Type', 2))]); }
function mathPayload(interaction, session) { return payload([text(header(interaction, session, `Solve this problem: **${session.question}**`)), sep(), row(button(`work:answer:${interaction.user.id}:${session.id}`, 'Answer', 2))]); }
function memoryRevealPayload(interaction, session) { return payload([text(header(interaction, session, `Remember this pattern: ${session.pattern.join(' ')}`)), sep(), row(...session.pattern.map((emoji, i) => button(`work:wait:${interaction.user.id}:${session.id}:${i}`, emoji, 2, true)))]); }
function memoryGuessPayload(interaction, session) { const done = new Set(session.doneOptions || []); return payload([text(header(interaction, session, 'What was the pattern in order?')), sep(), row(...session.options.map((emoji, i) => button(`work:memory:${interaction.user.id}:${session.id}:${i}`, emoji, done.has(i) ? 3 : 2, done.has(i))))]); }

function cleanup(id) { const s = activeSessions.get(id); if (!s) return; if (s.timer) clearTimeout(s.timer); if (s.revealTimer) clearTimeout(s.revealTimer); activeSessions.delete(id); }
function awardWork(interaction, session, ok) {
  const base = ri(session.job.min, session.job.max);
  const fullXp = ri(session.job.minXp, session.job.maxXp);
  const earned = ok ? base : Math.max(1, Math.floor(base * 0.10));
  const xp = ok ? fullXp : Math.max(1, Math.floor(fullXp * 0.10));
  addBalance(interaction.user.id, earned);
  recordGamblingEarnings(interaction.user.id, earned);
  if (interaction.guildId) addUserXp(interaction.guildId, interaction.user.id, xp);
  recordWork(interaction.user.id);
  setWorkCooldown(interaction.user.id, Date.now() + WORK_COOLDOWN_MS);
  return { earned, xp };
}
async function showFinished(interaction, session, ok) {
  cleanup(session.id); const reward = awardWork(interaction, session, ok);
  const line = ok ? `* ${YES} You have completed your work and earned ${formatAbbreviated(reward.earned)} ${PRCOIN} and ${formatNumber(reward.xp)} XP` : `* ${NO} You have failed your work and only earned ${formatAbbreviated(reward.earned)} ${PRCOIN} and ${formatNumber(reward.xp)} XP`;
  const h = home(interaction, line);
  if (typeof interaction.update === 'function') return interaction.update(h).catch(() => null);
  if (typeof interaction.deferUpdate === 'function') { await interaction.deferUpdate().catch(() => null); return session.message?.edit(h).catch(() => null); }
  await session.message?.edit(h).catch(() => null); if (!interaction.replied && !interaction.deferred && interaction.isRepliable?.()) await interaction.reply({ content: 'Work submitted.', flags: EPHEMERAL_FLAG }).catch(() => null);
}
function timeoutFail(interaction, session, ms) { session.timer = setTimeout(async () => { const current = activeSessions.get(session.id); if (!current || current.finished) return; current.finished = true; const reward = awardWork(interaction, current, false); cleanup(current.id); await current.message?.edit(home(interaction, `* ${NO} You have failed your work and only earned ${formatAbbreviated(reward.earned)} ${PRCOIN} and ${formatNumber(reward.xp)} XP`)).catch(() => null); }, ms); }
async function startTyping(interaction, job) { const s = { id: sid(), userId: interaction.user.id, job, code: code(), expiresAt: Date.now() + 15000, message: interaction.message }; activeSessions.set(s.id, s); timeoutFail(interaction, s, 15000); await interaction.update(typingPayload(interaction, s)); }
async function startMath(interaction, job) { const p = mathProblem(); const s = { id: sid(), userId: interaction.user.id, job, question: p.q, answer: p.a, expiresAt: Date.now() + 10000, message: interaction.message }; activeSessions.set(s.id, s); timeoutFail(interaction, s, 10000); await interaction.update(mathPayload(interaction, s)); }
async function startMemory(interaction, job) { const pattern = Array.from({ length: 4 }, () => pick(MEMORY_EMOJIS)); const s = { id: sid(), userId: interaction.user.id, job, pattern, options: shuffle(pattern), doneOptions: [], next: 0, expiresAt: Date.now() + 20000, message: interaction.message }; activeSessions.set(s.id, s); await interaction.update(memoryRevealPayload(interaction, s)); s.revealTimer = setTimeout(async () => { const current = activeSessions.get(s.id); if (!current || current.finished) return; current.expiresAt = Date.now() + 15000; timeoutFail(interaction, current, 15000); await interaction.message?.edit(memoryGuessPayload(interaction, current)).catch(() => null); }, ri(3000, 5000)); }
async function startWork(interaction) { const job = getJob(profile(interaction.user.id).jobId); if (!job || getWorkCooldown(interaction.user.id) > Date.now()) return interaction.update(home(interaction)).catch(() => null); const game = pick(job.games); if (game === 'typing') return startTyping(interaction, job); if (game === 'math') return startMath(interaction, job); return startMemory(interaction, job); }
function showModal(interaction, id, title, label, placeholder) { const modal = new ModalBuilder().setCustomId(id).setTitle(title).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('answer').setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(40).setPlaceholder(placeholder || ''))); return interaction.showModal(modal); }

module.exports = {
  data: new SlashCommandBuilder().setName('work').setDescription('Work to earn PRcoin. Cooldown: 5 minutes.'),
  async execute(interaction) { await interaction.reply(home(interaction)); },
  async handleInteraction(interaction) {
    if (interaction.isButton?.() && interaction.customId?.startsWith('work:')) {
      const parts = interaction.customId.split(':'); const action = parts[1];
      if (parts[2] !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own work controls.', flags: EPHEMERAL_FLAG }); return true; }
      if (action === 'start') { await startWork(interaction); return true; }
      if (action === 'jobs') { await interaction.update(jobsPage(interaction, Number(parts[3]) || 0)); return true; }
      if (action === 'jobpage') { await interaction.update(jobsPage(interaction, Number(parts[3]) || 0)); return true; }
      if (action === 'back') { await interaction.update(home(interaction)); return true; }
      if (action === 'apply') { const job = getJob(parts[3]); if (job && canApply(interaction, job)) setJob(interaction.user.id, job.id); await interaction.update(jobsPage(interaction, Number(parts[4]) || 0)); return true; }
      if (action === 'type' || action === 'answer') { const s = activeSessions.get(parts[3]); if (!s || s.userId !== interaction.user.id) { await interaction.reply({ content: 'This work challenge is no longer active.', flags: EPHEMERAL_FLAG }); return true; } await showModal(interaction, `workmodal:${action === 'type' ? 'typing' : 'math'}:${interaction.user.id}:${s.id}`, action === 'type' ? 'Typing Challenge' : 'Math Problem', action === 'type' ? 'Type the code exactly' : 'Enter the answer', action === 'type' ? s.code : s.question); return true; }
      if (action === 'memory') { const s = activeSessions.get(parts[3]); const optionIndex = Number(parts[4]); if (!s || s.userId !== interaction.user.id) { await interaction.reply({ content: 'This memory challenge is no longer active.', flags: EPHEMERAL_FLAG }); return true; } if (s.options[optionIndex] !== s.pattern[s.next]) { s.finished = true; await showFinished(interaction, s, false); return true; } s.doneOptions.push(optionIndex); s.next += 1; if (s.next >= s.pattern.length) { s.finished = true; await showFinished(interaction, s, true); return true; } await interaction.update(memoryGuessPayload(interaction, s)); return true; }
    }
    if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('workmodal:')) {
      const parts = interaction.customId.split(':'); if (parts[2] !== interaction.user.id) { await interaction.reply({ content: 'You can only submit your own work challenge.', flags: EPHEMERAL_FLAG }); return true; }
      const s = activeSessions.get(parts[3]); if (!s) { await interaction.reply({ content: 'This work challenge is no longer active.', flags: EPHEMERAL_FLAG }); return true; }
      const answer = interaction.fields.getTextInputValue('answer').trim(); s.finished = true; const ok = parts[1] === 'typing' ? answer === s.code : answer.replace(/,/g, '') === s.answer; await showFinished(interaction, s, ok); return true;
    }
    return false;
  },
};
