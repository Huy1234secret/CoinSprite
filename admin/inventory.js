(() => {
  'use strict';
  const $ = id => document.getElementById(id), shell = $('profileShell');
  if (!shell) return;
  let items = [], page = 1, ticketPage = 1, ticketMax = 1, request = 0, searchTimer;
  const tooltip = $('inventoryTooltip');
  async function get(url) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load inventory.'); return data;
  }
  function icon(emoji) {
    const match = /^<a?:\w+:(\d{16,20})>$/.exec(emoji || '');
    if (!match) return document.createTextNode(emoji || '📦');
    const img = document.createElement('img'); img.src = `https://cdn.discordapp.com/emojis/${match[1]}.png`;
    img.alt = emoji.includes('CSSCoin:') ? 'Silver coin' : emoji.includes('CSBC:') ? 'Bronze coin' : ''; return img;
  }
  function showTooltip(item, x, y) {
    tooltip.replaceChildren();
    const title = document.createElement('strong'); title.textContent = item.name; tooltip.append(title);
    for (const value of [`Rarity: ${item.rarity}`, `Type: ${item.type}`, `Value: ${item.value == null ? 'Not sold' : `${item.value.toLocaleString()} Bronze`}`, `Quantity: ${item.quantity}`, item.description || '']) {
      const line = document.createElement('div'); line.textContent = value; tooltip.append(line);
    }
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - tooltip.offsetWidth - 12))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y + 14, innerHeight - tooltip.offsetHeight - 12))}px`;
  }
  function render() {
    const grid = $('inventoryGrid'); grid.replaceChildren();
    const start = (page - 1) * 50;
    for (let n = 0; n < 50; n++) {
      const item = items[start + n], cell = document.createElement(item ? 'button' : 'div');
      cell.className = 'inventory-cell';
      if (item) {
        cell.type = 'button'; cell.setAttribute('aria-label', `${item.name}, quantity ${item.quantity}`);
        cell.append(icon(item.emoji)); const count = document.createElement('small'); count.textContent = item.quantity; cell.append(count);
        cell.onpointermove = e => showTooltip(item, e.clientX, e.clientY);
        cell.onpointerleave = cell.onblur = () => { tooltip.hidden = true; };
        cell.onfocus = () => { const box = cell.getBoundingClientRect(); showTooltip(item, box.left, box.bottom); };
        if (item.itemKey === 'lottery_ticket_1') cell.onclick = openTickets;
      } else cell.setAttribute('aria-hidden', 'true');
      grid.append(cell);
    }
    const max = Math.max(1, Math.ceil(items.length / 50));
    $('inventoryPage').textContent = `${page} / ${max}`;
    $('inventoryPrevious').disabled = page <= 1; $('inventoryNext').disabled = page >= max;
  }
  async function load() {
    $('inventoryStatus').textContent = 'Loading inventory…';
    try { items = (await get('/api/profile/inventory')).items; page = Math.min(page, Math.max(1, Math.ceil(items.length / 50))); render(); $('inventoryStatus').textContent = items.length ? '' : 'Your inventory is empty. Earn items through Work or visit /cs-shop.'; }
    catch (error) { $('inventoryStatus').textContent = error.message; }
  }
  function select(inventory) {
    $('webInventory').hidden = !inventory; shell.querySelector('.card-studio').hidden = inventory;
    shell.classList.toggle('inventory-selected', inventory);
    $('profileCardTab').setAttribute('aria-pressed', String(!inventory)); $('profileInventoryTab').setAttribute('aria-pressed', String(inventory));
    const url = new URL(location.href); if (inventory) url.searchParams.set('tab', 'inventory'); else url.searchParams.delete('tab'); history.replaceState(null, '', url);
    if (inventory && !shell.hidden) load();
  }
  async function tickets(reset = false) {
    if (reset) ticketPage = 1;
    const version = ++request, query = new URLSearchParams({ search: $('ticketSearch').value, page: String(ticketPage) });
    if ($('ticketDate').value) query.set('date', $('ticketDate').value);
    $('ticketStatus').textContent = 'Loading tickets…';
    try {
      const result = await get(`/api/profile/lottery?${query}`); if (version !== request) return;
      ticketPage = result.page; ticketMax = result.maxPages;
      $('ticketDate').replaceChildren(...[...new Set([result.date, ...result.dates])].sort().reverse().map(date => { const option = document.createElement('option'); option.value = date; option.textContent = date; option.selected = date === result.date; return option; }));
      $('ticketList').replaceChildren(...result.tickets.map(ticket => {
        const card = document.createElement('div'); card.className = `ticket-code prize-${ticket.rank || 'none'}`;
        const code = document.createElement('strong'); code.textContent = ticket.code; card.append(code);
        const status = document.createElement('small'); status.textContent = ticket.rank ? `${['', 'First', 'Second', 'Third'][ticket.rank]} Prize` : ticket.settled ? 'No prize' : 'Upcoming draw'; card.append(status);
        if (ticket.rank) {
          const total = BigInt(ticket.earnings), silver = total / 1000000n, bronze = total % 1000000n;
          const amount = document.createElement('small'); amount.className = 'ticket-earning'; amount.append('+');
          if (silver) { amount.append(`${silver.toLocaleString()} `, icon('<:CSSCoin:1544762630877745194>')); }
          if (bronze || !silver) { if (silver) amount.append(' · '); amount.append(`${bronze.toLocaleString()} `, icon('<:CSBC:1544762628474282064>')); }
          card.append(amount);
        }
        return card;
      }));
      $('ticketStatus').textContent = result.total ? `${result.total} ticket${result.total === 1 ? '' : 's'} · sorted by code` : 'No tickets found for this date.';
      $('ticketPage').textContent = `${ticketPage} / ${ticketMax}`; $('ticketPrevious').disabled = ticketPage <= 1; $('ticketNext').disabled = ticketPage >= ticketMax;
    } catch (error) { if (version === request) $('ticketStatus').textContent = error.message; }
  }
  function openTickets() { tooltip.hidden = true; $('ticketDialog').showModal(); tickets(true); }
  $('profileCardTab').onclick = () => select(false); $('profileInventoryTab').onclick = () => select(true);
  $('inventoryRefresh').onclick = load; $('ticketHistoryButton').onclick = openTickets; $('ticketClose').onclick = () => $('ticketDialog').close();
  $('inventoryPrevious').onclick = () => { if (page > 1) { page--; render(); } };
  $('inventoryNext').onclick = () => { if (page < Math.ceil(items.length / 50)) { page++; render(); } };
  $('ticketPrevious').onclick = () => { if (ticketPage > 1) { ticketPage--; tickets(); } };
  $('ticketNext').onclick = () => { if (ticketPage < ticketMax) { ticketPage++; tickets(); } };
  $('ticketDate').onchange = () => tickets(true);
  $('ticketSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => tickets(true), 200); };
  new MutationObserver(() => { if (!shell.hidden && !$('webInventory').hidden) load(); }).observe(shell, { attributes: true, attributeFilter: ['hidden'] });
  if (new URLSearchParams(location.search).get('tab') === 'inventory') select(true);
})();
