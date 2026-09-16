import { api } from './session.js';

export function initializeInventory() {
  const get = id => document.getElementById(id);
  let items = [], page = 1, ticketPage = 1, ticketMax = 1, inventoryRequest = 0, ticketRequest = 0, searchTimer;
  const tooltip = get('inventoryTooltip');
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
  function itemIcon(value) {
    const custom = /^<a?:\w+:(\d{16,20})>$/.exec(value || '');
    if (!custom) return document.createTextNode(value || '📦');
    const image = document.createElement('img');
    image.src = `https://cdn.discordapp.com/emojis/${custom[1]}.png`;
    image.alt = ''; image.loading = 'lazy'; return image;
  }
  function describe(item, x, y) {
    tooltip.replaceChildren(text('strong', item.name));
    const lines = [`Rarity: ${item.rarity}`, `Type: ${item.type}`, `Value: ${item.value == null ? 'Not sold' : `${item.value.toLocaleString()} Bronze`}`, `Quantity: ${item.quantity}`, item.description || ''];
    lines.forEach(line => tooltip.append(text('div', line)));
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y + 12, innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  function renderItems() {
    const grid = get('inventoryGrid'); grid.replaceChildren();
    for (let index = 0; index < 50; index++) {
      const item = items[(page - 1) * 50 + index];
      const cell = document.createElement(item ? 'button' : 'div'); cell.className = 'inventory-cell';
      if (!item) cell.setAttribute('aria-hidden', 'true');
      else {
        cell.type = 'button'; cell.setAttribute('aria-label', `${item.name}, quantity ${item.quantity}`);
        cell.setAttribute('aria-describedby', 'inventoryTooltip');
        cell.append(itemIcon(item.emoji), text('small', item.quantity));
        cell.addEventListener('pointermove', event => describe(item, event.clientX, event.clientY));
        cell.addEventListener('focus', () => { const box = cell.getBoundingClientRect(); describe(item, box.left, box.bottom); });
        for (const event of ['blur', 'pointerleave']) cell.addEventListener(event, () => { tooltip.hidden = true; });
        cell.addEventListener('click', () => {
          if (item.itemKey === 'lottery_ticket_1') openTickets();
          else { const box = cell.getBoundingClientRect(); describe(item, box.left, box.bottom); }
        });
      }
      grid.append(cell);
    }
    const max = Math.max(1, Math.ceil(items.length / 50));
    get('inventoryPage').textContent = `${page} / ${max}`;
    get('inventoryPrevious').disabled = page <= 1;
    get('inventoryNext').disabled = page >= max;
  }
  async function loadItems() {
    const request = ++inventoryRequest;
    get('inventoryStatus').textContent = 'Loading inventory…'; get('inventoryRefresh').disabled = true;
    get('inventoryGrid').setAttribute('aria-busy','true');
    try {
      const data = await api('/api/profile/inventory');
      if (request !== inventoryRequest) return;
      items = data.items || []; page = Math.min(page, Math.max(1, Math.ceil(items.length / 50)));
      renderItems();
      get('inventoryStatus').textContent = items.length ? `${items.length} item types · updated just now` : 'Your inventory is empty. Earn items through Work or visit /cs-shop.';
    } catch(error) { if (request === inventoryRequest) get('inventoryStatus').textContent = `${error.message} Use Refresh to try again.`; }
    finally { if (request === inventoryRequest) { get('inventoryRefresh').disabled = false; get('inventoryGrid').setAttribute('aria-busy','false'); } }
  }
  function selectInventory(selected) {
    get('webInventory').hidden = !selected;
    get('profileShell').querySelector('.card-studio').hidden = selected;
    get('profileCardTab').setAttribute('aria-pressed', String(!selected));
    get('profileInventoryTab').setAttribute('aria-pressed', String(selected));
    const url = new URL(location.href);
    if (selected) url.searchParams.set('tab','inventory'); else url.searchParams.delete('tab');
    history.replaceState(null,'',url);
    tooltip.hidden = true;
    if (selected && !get('profileShell').hidden) loadItems();
  }
  function earnings(value) {
    const total = BigInt(value), silver = total / 1000000n, bronze = total % 1000000n;
    return [silver ? `${silver.toLocaleString()} Silver` : '', bronze || !silver ? `${bronze.toLocaleString()} Bronze` : ''].filter(Boolean).join(' · ');
  }
  async function loadTickets(reset = false) {
    if (reset) ticketPage = 1;
    const request = ++ticketRequest;
    const query = new URLSearchParams({search:get('ticketSearch').value, page:String(ticketPage)});
    if (get('ticketDate').value) query.set('date',get('ticketDate').value);
    get('ticketStatus').textContent = 'Loading tickets…';
    get('ticketList').setAttribute('aria-busy','true');
    get('ticketPrevious').disabled = get('ticketNext').disabled = true;
    try {
      const data = await api(`/api/profile/lottery?${query}`);
      if (request !== ticketRequest) return;
      ticketPage = data.page; ticketMax = data.maxPages;
      get('ticketDate').replaceChildren(...[...new Set([data.date,...data.dates])].sort().reverse().map(date => new Option(date,date,false,date === data.date)));
      get('ticketList').replaceChildren(...data.tickets.map(ticket => {
        const card = document.createElement('article'); card.className = `ticket-code prize-${ticket.rank || 'none'}`;
        card.append(text('strong',ticket.code),text('small',ticket.rank ? `${['','First','Second','Third'][ticket.rank]} prize` : ticket.settled ? 'No prize' : 'Upcoming draw'));
        if (ticket.rank) card.append(text('small',`+${earnings(ticket.earnings)}`));
        return card;
      }));
      get('ticketStatus').textContent = data.total ? `${data.total} tickets · sorted by code` : 'No tickets found for this date.';
      get('ticketPage').textContent = `${ticketPage} / ${ticketMax}`;
    } catch(error) { if (request === ticketRequest) get('ticketStatus').textContent = `${error.message} Change the filter or reopen tickets to retry.`; }
    finally { if (request === ticketRequest) { get('ticketPrevious').disabled = ticketPage <= 1; get('ticketNext').disabled = ticketPage >= ticketMax; get('ticketList').setAttribute('aria-busy','false'); } }
  }
  function openTickets() { tooltip.hidden = true; get('ticketDialog').showModal(); loadTickets(true); }
  const actions = {
    profileCardTab:()=>selectInventory(false), profileInventoryTab:()=>selectInventory(true), inventoryRefresh:loadItems,
    ticketHistoryButton:openTickets, ticketClose:()=>get('ticketDialog').close(),
    inventoryPrevious:()=>{ if(page>1){page--;renderItems();} },
    inventoryNext:()=>{ if(page<Math.ceil(items.length/50)){page++;renderItems();} },
    ticketPrevious:()=>{if(ticketPage>1){ticketPage--;loadTickets();}},
    ticketNext:()=>{if(ticketPage<ticketMax){ticketPage++;loadTickets();}},
  };
  Object.entries(actions).forEach(([id,action])=>get(id).addEventListener('click',action));
  get('ticketDate').addEventListener('change',()=>loadTickets(true));
  get('ticketSearch').addEventListener('input',()=>{ clearTimeout(searchTimer); ticketRequest++; searchTimer = setTimeout(()=>loadTickets(true),200); });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')tooltip.hidden=true;});
  new MutationObserver(()=>{if(!get('profileShell').hidden&&!get('webInventory').hidden)loadItems();}).observe(get('profileShell'),{attributes:true,attributeFilter:['hidden']});
  if(new URLSearchParams(location.search).get('tab')==='inventory')selectInventory(true);
}
