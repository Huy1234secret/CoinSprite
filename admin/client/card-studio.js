// card-studio: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.
import { CARD_BUILTINS, CARD_FONT_FAMILIES, CARD_HISTORY_LIMIT, CARD_PREVIEW_DEBOUNCE_MS, CARD_REQUIRED_FONT_FACES, CARD_SNAP_DISTANCE, CARD_SNAP_RELEASE, CARD_TEMPLATES, cardDrawRequest, cardFontLoads, cardFontsReadyPromise, cardFrame, cardImages, elements, state } from './state.js';
import { api, clone, escapeHtml, showToast } from './session.js';
import { formatNumber } from './owner.js';
import { readMediaFile } from './composer.js';

export function cardSnapshot() {
    return state.profile ? JSON.stringify(state.profile.design) : '';
  }

export function refreshCardHistoryButtons() {
    elements.cardUndoButton.disabled = !state.cardUndoStack.length;
    elements.cardRedoButton.disabled = !state.cardRedoStack.length;
  }

export function pushCardHistory(stack, snapshot) {
    if (!snapshot || stack.at(-1) === snapshot) return;
    stack.push(snapshot);
    if (stack.length > CARD_HISTORY_LIMIT) stack.shift();
  }

export function commitCardHistory(before) {
    if (!before || before === cardSnapshot()) return false;
    pushCardHistory(state.cardUndoStack, before);
    state.cardRedoStack = [];
    refreshCardHistoryButtons();
    return true;
  }

export function mutateCardDesign(change) {
    if (!state.profile) return false;
    const before = cardSnapshot();
    change();
    return commitCardHistory(before);
  }

export function beginCardInputHistory() {
    if (!state.cardPendingHistory) state.cardPendingHistory = cardSnapshot();
  }

export function finishCardInputHistory() {
    if (!state.cardPendingHistory) return;
    const before = state.cardPendingHistory;
    state.cardPendingHistory = '';
    commitCardHistory(before);
  }

export function restoreCardHistory(snapshot) {
    state.profile.design = JSON.parse(snapshot);
    if (state.cardSelection !== 'background' && !cardSelectionObject()) state.cardSelection = 'background';
    renderCardStudio();
  }

export function undoCardDesign() {
    finishCardInputHistory();
    const snapshot = state.cardUndoStack.pop();
    if (!snapshot) return;
    pushCardHistory(state.cardRedoStack, cardSnapshot());
    restoreCardHistory(snapshot);
  }

export function redoCardDesign() {
    finishCardInputHistory();
    const snapshot = state.cardRedoStack.pop();
    if (!snapshot) return;
    pushCardHistory(state.cardUndoStack, cardSnapshot());
    restoreCardHistory(snapshot);
  }

export function applyCardTemplate() {
    const key = elements.cardTemplateSelect.value;
    const template = CARD_TEMPLATES[key];
    if (!template || !state.profile) return;
    const templateFont = { classic: 'sans', arcade: 'condensed', split: 'rounded', minimal: 'sans', spotlight: 'serif' }[key];
    mutateCardDesign(() => {
      const design = state.profile.design;
      design.panelOpacity = template.panelOpacity;
      design.colors = { ...design.colors, ...clone(template.colors) };
      for (const element of ['avatar', 'username', 'level', 'rank', 'progress', 'xp']) {
        design[element] = { ...design[element], ...clone(template[element]), visible: true, rotation: 0 };
      }
      for (const element of ['username', 'level', 'rank', 'xp']) design[element].fontFamily = templateFont;
    });
    state.cardSelection = 'background';
    renderCardStudio();
    showToast(`Applied the ${elements.cardTemplateSelect.selectedOptions[0].textContent} template.`);
  }

export function cardImage(url) {
    if (!url) return null;
    if (cardImages.has(url)) return cardImages.get(url).ready ? cardImages.get(url).image : null;
    const entry = { image: new Image(), ready: false };
    cardImages.set(url, entry);
    entry.image.crossOrigin = 'anonymous';
    entry.image.addEventListener('load', () => { entry.ready = true; scheduleCardDraw(); });
    entry.image.addEventListener('error', () => { entry.failed = true; });
    entry.image.src = url;
    return null;
  }

export function cardRoundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  }

export function drawCardCover(context, image, x, y, width, height, offsetX = 0, offsetY = 0, scale = 1) {
    const base = Math.max(width / image.naturalWidth, height / image.naturalHeight) * scale;
    const drawWidth = image.naturalWidth * base;
    const drawHeight = image.naturalHeight * base;
    context.drawImage(image, x + (width - drawWidth) / 2 + offsetX, y + (height - drawHeight) / 2 + offsetY, drawWidth, drawHeight);
  }

export function normalizedCardRotation(value) {
    const rotation = Number(value);
    if (!Number.isFinite(rotation)) return 0;
    return ((rotation + 180) % 360 + 360) % 360 - 180;
  }

export function cardFont(item, size = item?.size) {
    const family = CARD_FONT_FAMILIES[item?.fontFamily] || CARD_FONT_FAMILIES.sans;
    return `${item?.italic ? 'italic' : 'normal'} ${item?.bold === false || item?.weight === 'normal' ? 'normal' : 'bold'} ${Math.max(1, Number(size) || 1)}px ${family}`;
  }

export function normalizedFontFaceFamily(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '');
  }

export function ensureCardFontsReady() {
    if (cardFontsReadyPromise.value) return cardFontsReadyPromise.value;
    cardFontsReadyPromise.value = (async () => {
      if (!document.fonts?.load || !document.fonts?.check || !document.fonts?.ready || !document.fonts[Symbol.iterator]) {
        throw new Error('This browser cannot verify the required level-card fonts. The draft editor is unavailable.');
      }
      const requests = [];
      for (const face of CARD_REQUIRED_FONT_FACES) {
        const styles = face.italic ? ['normal', 'italic'] : ['normal'];
        for (const style of styles) {
          for (const weight of [400, 700]) {
            const font = `${style} ${weight} 32px "${face.family}"`;
            requests.push(document.fonts.load(font, face.family === 'Noto Sans SC Variable' ? '\u6c49\u5b57' : 'CoinSprite')
              .then((loaded) => {
                const exact = [...loaded].some((entry) => normalizedFontFaceFamily(entry.family) === face.family && entry.status === 'loaded');
                const declared = [...document.fonts].some((entry) => normalizedFontFaceFamily(entry.family) === face.family && entry.status === 'loaded');
                if (!exact || !declared || !document.fonts.check(font, face.family === 'Noto Sans SC Variable' ? '\u6c49\u5b57' : 'CoinSprite')) {
                  throw new Error(`Required browser font silently fell back: ${face.family} (${style} ${weight}).`);
                }
              }));
          }
        }
      }
      await Promise.all(requests);
      await document.fonts.ready;
      return true;
    })().catch((error) => {
      cardFontsReadyPromise.value = null;
      throw error;
    });
    return cardFontsReadyPromise.value;
  }

export function loadCardFont(item, text) {
    const font = cardFont(item);
    const sample = String(text || 'CoinSprite');
    const key = `${font}\0${sample}`;
    if (cardFontLoads.has(key)) return cardFontLoads.get(key);
    const loading = ensureCardFontsReady()
      .then(() => document.fonts.load(font, sample))
      .catch((error) => {
        cardFontLoads.delete(key);
        throw new Error(`Card draft font failed to load without fallback: ${font}`, { cause: error });
      });
    cardFontLoads.set(key, loading);
    return loading;
  }

export function cardTextValue(selection, layer = cardLayerBySelection(selection)) {
    if (layer?.type === 'text') return layer.text || 'Text';
    const preview = state.profile?.preview || {};
    if (selection === 'username') return String(preview.username || 'Member').normalize('NFKC').replace(/^\*\*([\s\S]+)\*\*$/u, '$1');
    if (selection === 'level') return `LEVEL ${formatNumber(preview.level)}`;
    if (selection === 'rank') return `#${formatNumber(preview.rank)}`;
    if (selection === 'xp') return preview.neededXp
      ? `${formatNumber(preview.progressXp)} / ${formatNumber(preview.neededXp)} XP`
      : `${formatNumber(preview.xp)} XP - MAX LEVEL`;
    return '';
  }

export function cardTextBounds(context, item, text, align = 'left') {
    context.save();
    context.textBaseline = 'top';
    context.textAlign = align;
    context.font = cardFont(item);
    const metrics = context.measureText(String(text || ''));
    let left = -(Number(metrics.actualBoundingBoxLeft) || 0);
    let right = Number(metrics.actualBoundingBoxRight) || Number(metrics.width) || 1;
    if (item.underline) {
      const underlineLeft = align === 'right' ? -metrics.width : 0;
      const underlineRight = align === 'right' ? 0 : metrics.width;
      left = Math.min(left, underlineLeft);
      right = Math.max(right, underlineRight);
    }
    const ascent = Number(metrics.actualBoundingBoxAscent) || 0;
    const descent = Number(metrics.actualBoundingBoxDescent) || Number(item.size) || 1;
    const underlineBottom = item.underline ? Number(item.size) * 1.08 + Math.max(1, Number(item.size) / 30) : descent;
    context.restore();
    return {
      x: item.x + left,
      y: item.y - ascent,
      width: Math.max(1, right - left),
      height: Math.max(1, ascent + Math.max(descent, underlineBottom)),
      resize: 'text',
      rotation: normalizedCardRotation(item.rotation),
    };
  }

export function rotateCardPoint(point, center, degrees) {
    const angle = normalizedCardRotation(degrees) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
  }

export function cardBoundsCenter(bounds) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

export function cardPointInBounds(point, bounds) {
    const local = rotateCardPoint(point, cardBoundsCenter(bounds), -bounds.rotation);
    return local.x >= bounds.x - 5 && local.x <= bounds.x + bounds.width + 5
      && local.y >= bounds.y - 5 && local.y <= bounds.y + bounds.height + 5;
  }

export function cardVisualBounds(bounds) {
    if (!bounds?.rotation) return bounds;
    const center = cardBoundsCenter(bounds);
    const points = [
      { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
    ].map((point) => rotateCardPoint(point, center, bounds.rotation));
    const x = points.map((point) => point.x);
    const y = points.map((point) => point.y);
    return { x: Math.min(...x), y: Math.min(...y), width: Math.max(...x) - Math.min(...x), height: Math.max(...y) - Math.min(...y) };
  }

export function withCardRotation(context, bounds, draw) {
    context.save();
    const center = cardBoundsCenter(bounds);
    context.translate(center.x, center.y);
    context.rotate(normalizedCardRotation(bounds.rotation) * Math.PI / 180);
    context.translate(-center.x, -center.y);
    draw();
    context.restore();
  }

export function cardLayerBySelection(selection = state.cardSelection) {
    if (!selection.startsWith('layer:')) return null;
    return state.profile?.design.layers.find((layer) => layer.id === selection.slice(6)) || null;
  }

export function cardSelectionObject(selection = state.cardSelection) {
    if (!state.profile) return null;
    return cardLayerBySelection(selection) || state.profile.design[selection] || null;
  }

export function cardBounds(selection = state.cardSelection, context = elements.cardCanvas.getContext('2d')) {
    if (!state.profile) return null;
    const design = state.profile.design;
    const layer = cardLayerBySelection(selection);
    if (selection === 'background') return { x: 0, y: 0, width: 1000, height: 320, resize: false };
    const item = layer || design[selection];
    if (!item || item.visible === false) return null;
    if (layer?.type === 'text' || ['username', 'level', 'rank', 'xp'].includes(selection)) {
      return cardTextBounds(context, item, cardTextValue(selection, layer), selection === 'rank' ? 'right' : 'left');
    }
    if (layer) return { x: layer.x, y: layer.y, width: layer.width, height: layer.height, resize: 'free', rotation: normalizedCardRotation(layer.rotation) };
    if (selection === 'avatar') return { x: design.avatar.x, y: design.avatar.y, width: design.avatar.size, height: design.avatar.size, resize: 'square', rotation: normalizedCardRotation(design.avatar.rotation) };
    if (selection === 'progress') return { x: design.progress.x, y: design.progress.y, width: design.progress.width, height: design.progress.height, resize: 'free', rotation: normalizedCardRotation(design.progress.rotation) };
    return null;
  }

export function showDraftCardPreview() {
    elements.cardAuthoritativeCanvas.hidden = true;
    elements.cardCanvas.hidden = false;
    elements.cardPreviewLabel.querySelector('strong').textContent = 'Draft preview';
    elements.cardPreviewLabel.querySelector('small').textContent = 'Unsaved browser draft; a server-rendered preview is loading.';
  }

export function scheduleCardDraw() {
    showDraftCardPreview();
    scheduleAuthoritativeCardPreview();
    window.cancelAnimationFrame(cardFrame.value);
    const request = ++cardDrawRequest.value;
    cardFrame.value = window.requestAnimationFrame(async () => {
      try {
        const design = state.profile?.design;
        if (!design) return;
        const textItems = [
          ['username', design.username], ['level', design.level], ['rank', design.rank], ['xp', design.xp],
          ...design.layers.filter((layer) => layer.type === 'text').map((layer) => [`layer:${layer.id}`, layer]),
        ];
        await Promise.all(textItems.map(([selection, item]) => loadCardFont(item, cardTextValue(selection, item))));
        if (request === cardDrawRequest.value) drawCardPreview();
      } catch (error) {
        if (request === cardDrawRequest.value) showToast(error.message, 'error');
      }
    });
  }

export function drawCardPreviewText(context, text, item, align = 'left') {
    const bounds = cardTextBounds(context, item, text, align);
    withCardRotation(context, bounds, () => {
      context.textBaseline = 'top';
      context.textAlign = align;
      context.fillStyle = item.color;
      context.font = cardFont(item);
      context.fillText(text, item.x, item.y);
      if (item.underline) {
        const width = context.measureText(text).width;
        const start = align === 'right' ? item.x - width : item.x;
        const y = item.y + item.size * 1.08;
        context.strokeStyle = item.color;
        context.lineWidth = Math.max(1, item.size / 15);
        context.beginPath();
        context.moveTo(start, y);
        context.lineTo(start + width, y);
        context.stroke();
      }
    });
  }

export function cardHandlePositions(bounds) {
    if (!bounds?.resize) return [];
    const points = [
      ['nw', bounds.x, bounds.y], ['n', bounds.x + bounds.width / 2, bounds.y], ['ne', bounds.x + bounds.width, bounds.y],
      ['e', bounds.x + bounds.width, bounds.y + bounds.height / 2],
      ['se', bounds.x + bounds.width, bounds.y + bounds.height], ['s', bounds.x + bounds.width / 2, bounds.y + bounds.height],
      ['sw', bounds.x, bounds.y + bounds.height], ['w', bounds.x, bounds.y + bounds.height / 2],
    ];
    const center = cardBoundsCenter(bounds);
    return points.map(([handle, x, y]) => ({ handle, ...rotateCardPoint({ x, y }, center, bounds.rotation) }));
  }

export function cardHandleMetrics(bounds) {
    const shortest = Math.max(1, Math.min(bounds.width, bounds.height));
    const size = Math.min(10, Math.max(4, shortest * .22));
    return {
      size,
      hitRadius: Math.max(5, size),
      rotateDistance: Math.min(28, Math.max(14, shortest * .45)),
    };
  }

export function cardRotateHandle(bounds) {
    if (!bounds?.resize) return null;
    const center = cardBoundsCenter(bounds);
    const { rotateDistance } = cardHandleMetrics(bounds);
    return { handle: 'rotate', ...rotateCardPoint({ x: bounds.x + bounds.width / 2, y: bounds.y - rotateDistance }, center, bounds.rotation) };
  }

export function drawCardPreview() {
    if (!state.profile || elements.profileShell.hidden) return;
    const { design, preview } = state.profile;
    const canvas = elements.cardCanvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    try {
      cardRoundRect(context, 0, 0, 1000, 320, 30);
      context.clip();
      context.fillStyle = design.background.color;
      context.fillRect(0, 0, 1000, 320);
      const background = cardImage(design.background.imageUrl);
      if (background) drawCardCover(context, background, 0, 0, 1000, 320, design.background.x, design.background.y, design.background.scale);
      context.globalAlpha = Number.isFinite(Number(design.panelOpacity)) ? Math.max(0, Math.min(1, Number(design.panelOpacity))) : .85;
      context.fillStyle = design.colors.surface;
      cardRoundRect(context, 28, 28, 944, 264, 24);
      context.fill();
      context.globalAlpha = 1;

      if (design.avatar.visible !== false) {
        const avatarBounds = cardBounds('avatar', context);
        withCardRotation(context, avatarBounds, () => {
          context.save();
          context.fillStyle = design.avatar.color;
          cardRoundRect(context, design.avatar.x - 5, design.avatar.y - 5, design.avatar.size + 10, design.avatar.size + 10, design.avatar.size / 2);
          context.fill();
          cardRoundRect(context, design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size, design.avatar.size / 2);
          context.clip();
          const avatar = cardImage(preview.avatarUrl);
          if (avatar) context.drawImage(avatar, design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size);
          else {
            context.fillStyle = design.colors.track;
            context.fillRect(design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size);
          }
          context.restore();
        });
      }

      if (design.username.visible !== false) drawCardPreviewText(context, cardTextValue('username'), design.username);
      if (design.level.visible !== false) drawCardPreviewText(context, cardTextValue('level'), design.level);
      if (design.rank.visible !== false) drawCardPreviewText(context, cardTextValue('rank'), design.rank, 'right');

      if (design.progress.visible !== false) {
        const progressBounds = cardBounds('progress', context);
        withCardRotation(context, progressBounds, () => {
          context.fillStyle = design.progress.trackColor;
          cardRoundRect(context, design.progress.x, design.progress.y, design.progress.width, design.progress.height, design.progress.height / 2);
          context.fill();
          const progressWidth = design.progress.width * Math.max(0, Math.min(1, Number(preview.progressRatio) || 0));
          if (progressWidth) {
            context.fillStyle = design.progress.color;
            cardRoundRect(context, design.progress.x, design.progress.y, progressWidth, design.progress.height, design.progress.height / 2);
            context.fill();
          }
        });
      }
      if (design.xp.visible !== false) drawCardPreviewText(context, cardTextValue('xp'), design.xp);

      for (const layer of design.layers) {
        if (layer.visible === false) continue;
        if (layer.type === 'image') {
          const image = cardImage(layer.imageUrl);
          const layerBounds = cardBounds(`layer:${layer.id}`, context);
          if (image) withCardRotation(context, layerBounds, () => context.drawImage(image, layer.x, layer.y, layer.width, layer.height));
        } else drawCardPreviewText(context, layer.text, layer);
      }
    } finally {
      context.restore();
    }

    if (Number.isFinite(state.cardGuides.x) || Number.isFinite(state.cardGuides.y)) {
      context.save();
      context.strokeStyle = '#5ce1e6';
      context.lineWidth = 1.5;
      context.setLineDash([8, 5]);
      if (Number.isFinite(state.cardGuides.x)) {
        context.beginPath(); context.moveTo(state.cardGuides.x, 0); context.lineTo(state.cardGuides.x, 320); context.stroke();
      }
      if (Number.isFinite(state.cardGuides.y)) {
        context.beginPath(); context.moveTo(0, state.cardGuides.y); context.lineTo(1000, state.cardGuides.y); context.stroke();
      }
      context.restore();
    }

    const bounds = cardBounds(state.cardSelection, context);
    if (bounds) {
      context.save();
      context.strokeStyle = '#b9f547';
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      const controls = cardHandleMetrics(bounds);
      withCardRotation(context, bounds, () => {
        context.strokeRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6);
        if (bounds.resize) {
          context.beginPath();
          context.moveTo(bounds.x + bounds.width / 2, bounds.y - 3);
          context.lineTo(bounds.x + bounds.width / 2, bounds.y - controls.rotateDistance);
          context.stroke();
        }
      });
      context.setLineDash([]);
      if (bounds.resize) {
        for (const handle of cardHandlePositions(bounds)) {
          context.fillStyle = '#b9f547';
          context.fillRect(handle.x - controls.size / 2, handle.y - controls.size / 2, controls.size, controls.size);
          context.strokeStyle = '#0b0f0d';
          context.strokeRect(handle.x - controls.size / 2, handle.y - controls.size / 2, controls.size, controls.size);
        }
        const rotate = cardRotateHandle(bounds);
        context.beginPath();
        context.arc(rotate.x, rotate.y, Math.max(3, controls.size * .6), 0, Math.PI * 2);
        context.fillStyle = '#5ce1e6';
        context.fill();
        context.strokeStyle = '#0b0f0d';
        context.stroke();
      }
      context.restore();
    }
  }

export function renderCardLayers() {
    if (!state.profile) return;
    const row = (selection, icon, label, item, canHide = true) => `<div class="layer-row${item?.visible === false ? ' is-hidden' : ''}">
      <button class="layer-button${state.cardSelection === selection ? ' active' : ''}" type="button" data-card-selection="${escapeHtml(selection)}"><i>${icon}</i><span>${escapeHtml(label)}</span></button>
      ${canHide ? `<button class="layer-visibility" type="button" data-card-visibility="${escapeHtml(selection)}" aria-label="${item?.visible === false ? 'Show' : 'Hide'} ${escapeHtml(label)}" title="${item?.visible === false ? 'Show' : 'Hide'} element">${item?.visible === false ? '🙈' : '👁️'}</button>` : ''}
    </div>`;
    const builtins = CARD_BUILTINS.map(([key, icon, label]) => row(key, icon, label, state.profile.design[key], key !== 'background')).join('');
    const layers = state.profile.design.layers.map((layer) => {
      const selection = `layer:${layer.id}`;
      const label = layer.type === 'text' ? layer.text : 'Uploaded image';
      return row(selection, layer.type === 'text' ? '✏️' : '🖼️', label, layer);
    }).join('');
    elements.cardLayerList.innerHTML = builtins + layers;
  }

export function inspectorInput(label, path, value, options = {}) {
    const wide = options.wide ? ' wide' : '';
    const type = options.type || 'number';
    const attributes = type === 'number' ? ` min="${options.min ?? -1000}" max="${options.max ?? 1000}" step="${options.step ?? 1}"` : '';
    if (type === 'textarea') return `<label class="${wide.trim()}">${label}<textarea maxlength="120" data-card-field="${path}">${escapeHtml(value)}</textarea></label>`;
    return `<label class="${wide.trim()}">${label}<input type="${type}" value="${escapeHtml(value)}" data-card-field="${path}"${attributes}></label>`;
  }

export function inspectorSelect(label, path, value) {
    const options = [
      ['sans', 'Noto Sans'], ['serif', 'Noto Serif'], ['mono', 'Roboto Mono'],
      ['rounded', 'Nunito Rounded'], ['condensed', 'Oswald Condensed'], ['handwriting', 'Caveat Handwriting'],
    ]
      .map(([key, name]) => `<option value="${key}"${value === key ? ' selected' : ''}>${name}</option>`).join('');
    return `<label class="wide">${label}<select data-card-field="${path}">${options}</select></label>`;
  }

export function inspectorFormatting(prefix, item) {
    return `<div class="inspector-format wide" aria-label="Text formatting">
      <button type="button" aria-label="Bold" data-card-toggle="${prefix}.bold" class="${item.bold !== false ? 'active' : ''}" aria-pressed="${item.bold !== false}"><b>B</b></button>
      <button type="button" aria-label="Italic" data-card-toggle="${prefix}.italic" class="${item.italic ? 'active' : ''}" aria-pressed="${Boolean(item.italic)}"><i>I</i></button>
      <button type="button" aria-label="Underline" data-card-toggle="${prefix}.underline" class="${item.underline ? 'active' : ''}" aria-pressed="${Boolean(item.underline)}"><u>U</u></button>
    </div>`;
  }

export function renderCardInspector() {
    if (!state.profile) return;
    const selection = state.cardSelection;
    const layer = cardLayerBySelection(selection);
    const item = layer || state.profile.design[selection];
    const title = layer ? (layer.type === 'text' ? 'Text layer' : 'Image layer') : (CARD_BUILTINS.find(([key]) => key === selection)?.[2] || 'Element');
    elements.cardInspectorTitle.textContent = title;
    let fields = '';
    if (selection === 'background') {
      fields = inspectorInput('Card color', 'background.color', item.color, { type: 'color' })
        + inspectorInput('Panel color', 'colors.surface', state.profile.design.colors.surface, { type: 'color' })
        + inspectorInput('Panel opacity', 'panelOpacity', state.profile.design.panelOpacity ?? .85, { min: 0, max: 1, step: .05, wide: true })
        + inspectorInput('Image X', 'background.x', item.x, { min: -1000, max: 1000 })
        + inspectorInput('Image Y', 'background.y', item.y, { min: -320, max: 320 })
        + inspectorInput('Image scale', 'background.scale', item.scale, { min: .25, max: 5, step: .05, wide: true });
    } else if (selection === 'avatar') {
      fields = inspectorInput('X', 'avatar.x', item.x, { min: 0, max: 950 }) + inspectorInput('Y', 'avatar.y', item.y, { min: 0, max: 270 })
        + inspectorInput('Size', 'avatar.size', item.size, { min: 32, max: 240 }) + inspectorInput('Rotation', 'avatar.rotation', item.rotation || 0, { min: -180, max: 180 })
        + inspectorInput('Ring color', 'avatar.color', item.color, { type: 'color', wide: true });
    } else if (selection === 'progress') {
      fields = inspectorInput('X', 'progress.x', item.x) + inspectorInput('Y', 'progress.y', item.y)
        + inspectorInput('Width', 'progress.width', item.width, { min: 40, max: 950 }) + inspectorInput('Height', 'progress.height', item.height, { min: 6, max: 70 })
        + inspectorInput('Rotation', 'progress.rotation', item.rotation || 0, { min: -180, max: 180, wide: true })
        + inspectorInput('Bar color', 'progress.color', item.color, { type: 'color' }) + inspectorInput('Track color', 'progress.trackColor', item.trackColor, { type: 'color' });
    } else if (layer?.type === 'image') {
      fields = inspectorInput('X', `layers.${layer.id}.x`, layer.x) + inspectorInput('Y', `layers.${layer.id}.y`, layer.y)
        + inspectorInput('Width', `layers.${layer.id}.width`, layer.width, { min: 12, max: 800 }) + inspectorInput('Height', `layers.${layer.id}.height`, layer.height, { min: 12, max: 320 })
        + inspectorInput('Rotation', `layers.${layer.id}.rotation`, layer.rotation || 0, { min: -180, max: 180, wide: true })
        + '<div class="inspector-divider"></div><button class="inspector-delete" type="button" data-delete-card-layer>Delete image</button>';
    } else if (layer?.type === 'text') {
      const prefix = `layers.${layer.id}`;
      fields = inspectorInput('Text', `layers.${layer.id}.text`, layer.text, { type: 'textarea', wide: true })
        + inspectorInput('X', `layers.${layer.id}.x`, layer.x) + inspectorInput('Y', `layers.${layer.id}.y`, layer.y)
        + inspectorInput('Font size', `${prefix}.size`, layer.size, { min: 10, max: 96 }) + inspectorInput('Rotation', `${prefix}.rotation`, layer.rotation || 0, { min: -180, max: 180 })
        + inspectorSelect('Font', `${prefix}.fontFamily`, layer.fontFamily || 'sans') + inspectorFormatting(prefix, layer)
        + inspectorInput('Color', `${prefix}.color`, layer.color, { type: 'color', wide: true })
        + '<div class="inspector-divider"></div><button class="inspector-delete" type="button" data-delete-card-layer>Delete text</button>';
    } else {
      const prefix = selection;
      fields = inspectorInput('X', `${selection}.x`, item.x) + inspectorInput('Y', `${selection}.y`, item.y)
        + inspectorInput('Font size', `${selection}.size`, item.size, { min: 12, max: 80 }) + inspectorInput('Rotation', `${selection}.rotation`, item.rotation || 0, { min: -180, max: 180 })
        + inspectorSelect('Font', `${prefix}.fontFamily`, item.fontFamily || 'sans') + inspectorFormatting(prefix, item)
        + inspectorInput('Color', `${selection}.color`, item.color, { type: 'color', wide: true });
    }
    elements.cardInspector.innerHTML = `<div class="inspector-fields">${fields}</div>`;
  }

export function setCardField(path, value) {
    const parts = path.split('.');
    let target = state.profile.design;
    if (parts[0] === 'layers') {
      target = state.profile.design.layers.find((layer) => layer.id === parts[1]);
      parts.splice(0, 2);
    }
    if (!target) return;
    while (parts.length > 1) target = target[parts.shift()];
    const key = parts[0];
    target[key] = typeof target[key] === 'number' ? Number(value) : value;
  }

export function getCardField(path) {
    const parts = path.split('.');
    let target = state.profile.design;
    if (parts[0] === 'layers') {
      target = state.profile.design.layers.find((layer) => layer.id === parts[1]);
      parts.splice(0, 2);
    }
    while (target && parts.length) target = target[parts.shift()];
    return target;
  }

export function constrainCardSelection(selection = state.cardSelection) {
    if (!state.profile) return;
    const limit = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
    if (selection === 'background') {
      state.profile.design.panelOpacity = limit(state.profile.design.panelOpacity ?? .85, 0, 1);
      state.profile.design.background.x = limit(state.profile.design.background.x, -1000, 1000);
      state.profile.design.background.y = limit(state.profile.design.background.y, -320, 320);
      state.profile.design.background.scale = limit(state.profile.design.background.scale, .25, 5);
      return;
    }
    const target = cardSelectionObject(selection);
    if (!target) return;
    target.rotation = normalizedCardRotation(target.rotation);
    const layer = cardLayerBySelection(selection);
    if (selection === 'avatar') {
      target.size = limit(target.size, 32, 240);
      target.x = limit(target.x, 0, 1000 - target.size);
      target.y = limit(target.y, 0, 320 - target.size);
      return;
    }
    if (selection === 'progress') {
      target.width = limit(target.width, 40, 1000);
      target.height = limit(target.height, 6, 70);
      target.x = limit(target.x, 0, 1000 - target.width);
      target.y = limit(target.y, 0, 320 - target.height);
      return;
    }
    if (layer) {
      if (layer.type === 'text') {
        layer.size = limit(layer.size, 10, 96);
        const context = elements.cardCanvas.getContext('2d');
        context.font = cardFont(layer);
        const metrics = context.measureText(layer.text || 'Text');
        layer.width = Math.min(1000, Math.max(1, Math.ceil(metrics.width)));
        layer.height = Math.min(320, Math.max(1, Math.ceil((Number(metrics.actualBoundingBoxAscent) || 0) + (Number(metrics.actualBoundingBoxDescent) || layer.size))));
        layer.weight = layer.bold === false ? 'normal' : 'bold';
      } else {
        layer.width = limit(layer.width, 12, 1000);
        layer.height = limit(layer.height, 12, 320);
      }
      layer.x = limit(layer.x, 0, 1000 - layer.width);
      layer.y = limit(layer.y, 0, 320 - layer.height);
      return;
    }
    const bounds = cardBounds(selection);
    if (!bounds) return;
    target.size = limit(target.size, 12, 80);
    const fitted = cardBounds(selection);
    if (fitted.x < 0) target.x -= fitted.x;
    if (fitted.x + fitted.width > 1000) target.x -= fitted.x + fitted.width - 1000;
    if (fitted.y < 0) target.y -= fitted.y;
    if (fitted.y + fitted.height > 320) target.y -= fitted.y + fitted.height - 320;
  }

export function refreshCardDirty() {
    const dirty = cardSnapshot() !== state.profileSavedSnapshot;
    elements.profileSaveDock.hidden = !dirty && !state.cardSaving;
    elements.cardSaveButton.disabled = !dirty || state.cardSaving;
    elements.cardResetButton.disabled = !dirty || state.cardSaving;
    refreshCardHistoryButtons();
  }

export function renderCardStudio(draw = true) {
    renderCardLayers();
    renderCardInspector();
    refreshCardDirty();
    if (draw) scheduleCardDraw();
  }

export function scheduleAuthoritativeCardPreview() {
    window.clearTimeout(state.cardPreviewTimer);
    state.cardPreviewTimer = window.setTimeout(() => {
      loadAuthoritativeCardPreview().catch(() => null);
    }, CARD_PREVIEW_DEBOUNCE_MS);
  }

export function showAuthoritativeCardPreview(draft) {
    elements.cardCanvas.hidden = true;
    elements.cardAuthoritativeCanvas.hidden = false;
    elements.cardPreviewLabel.querySelector('strong').textContent = draft ? 'Authoritative server draft' : 'Authoritative Discord render';
    elements.cardPreviewLabel.querySelector('small').textContent = draft
      ? 'Rendered on the server; save to publish this design to /level.'
      : 'This saved PNG is rendered by the same server used by /level.';
  }

export async function loadAuthoritativeCardPreview() {
    window.clearTimeout(state.cardPreviewTimer);
    state.cardPreviewTimer = null;
    const expectedSavedHash = String(state.profile?.designHash || '');
    const designSnapshot = cardSnapshot();
    const draft = designSnapshot !== state.profileSavedSnapshot;
    const request = ++state.cardPreviewRequest;
    if (!expectedSavedHash) return;
    try {
      const response = await fetch('/api/profile/card/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'image/png',
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.csrfToken,
        },
        body: JSON.stringify({
          designHash: expectedSavedHash,
          draft,
          ...(draft ? { design: state.profile.design } : {}),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Authoritative level-card render failed (${response.status})`);
      }
      const responseHash = String(response.headers.get('x-coinsprite-design-hash') || '');
      const responseSource = String(response.headers.get('x-coinsprite-render-source') || '');
      if (request !== state.cardPreviewRequest || expectedSavedHash !== state.profile?.designHash || designSnapshot !== cardSnapshot()) return;
      if (!draft && responseHash !== expectedSavedHash) throw new Error('Authoritative saved preview returned a different design hash.');
      if (responseSource !== (draft ? 'authoritative-draft' : 'authoritative')) throw new Error('Level-card preview did not come from the authoritative renderer.');
      // Decode the authenticated response directly. Blob image URLs are intentionally
      // disallowed by the server's existing Content Security Policy.
      const image = await createImageBitmap(await response.blob());
      try {
        if (request !== state.cardPreviewRequest || expectedSavedHash !== state.profile?.designHash || designSnapshot !== cardSnapshot()) return;
        if (image.width !== 1000 || image.height !== 320) throw new Error('Authoritative level-card render returned unexpected dimensions.');
        const context = elements.cardAuthoritativeCanvas.getContext('2d');
        context.clearRect(0, 0, 1000, 320);
        context.drawImage(image, 0, 0);
      } finally {
        image.close();
      }
      state.cardPreviewHash = responseHash;
      showAuthoritativeCardPreview(draft);
    } catch (error) {
      if (request === state.cardPreviewRequest && expectedSavedHash === state.profile?.designHash && designSnapshot === cardSnapshot()) {
        showDraftCardPreview();
        elements.cardPreviewLabel.querySelector('small').textContent = 'Authoritative server preview unavailable; this remains a labelled browser draft.';
        showToast(error.message, 'error');
      }
      throw error;
    }
  }

export async function loadProfile() {
    try {
      state.profile = await api('/api/profile/card');
      state.profileSavedSnapshot = cardSnapshot();
      state.cardSelection = 'background';
      state.cardUndoStack = [];
      state.cardRedoStack = [];
      state.cardPendingHistory = '';
      renderCardStudio(false);
      await loadAuthoritativeCardPreview();
      await ensureCardFontsReady();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

export async function saveProfileCard() {
    if (!state.profile || state.cardSaving || cardSnapshot() === state.profileSavedSnapshot) return;
    state.cardSaving = true;
    refreshCardDirty();
    try {
      const payload = await api('/api/profile/card', { method: 'PATCH', body: JSON.stringify({ design: state.profile.design }) });
      state.profile.design = payload.design;
      state.profile.updatedAt = payload.updatedAt;
      state.profile.designHash = payload.designHash;
      state.profileSavedSnapshot = cardSnapshot();
      renderCardStudio();
      showToast('Your /level card is updated.');
      await loadAuthoritativeCardPreview();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      state.cardSaving = false;
      refreshCardDirty();
    }
  }

export async function uploadCardMedia(input, kind) {
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      input.value = '';
      return showToast('Upload a PNG, JPG, or WEBP image up to 5 MB.', 'error');
    }
    try {
      const payload = await api('/api/profile/card/media', { method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }) });
      const before = cardSnapshot();
      if (kind === 'background') {
        state.profile.design.background.imageUrl = payload.url;
        state.profile.design.background.x = 0;
        state.profile.design.background.y = 0;
        state.profile.design.background.scale = 1;
        state.cardSelection = 'background';
      } else {
        const id = `image-${Date.now().toString(36)}`;
        state.profile.design.layers.push({ id, type: 'image', imageUrl: payload.url, x: 420, y: 80, width: 140, height: 140, visible: true, rotation: 0 });
        state.cardSelection = `layer:${id}`;
      }
      commitCardHistory(before);
      renderCardStudio();
      showToast('Artwork added. Save when you are ready.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      input.value = '';
    }
  }

export function addCardText() {
    if (!state.profile || state.profile.design.layers.length >= 20) return showToast('This card already has the maximum of 20 custom layers.', 'error');
    const id = `text-${Date.now().toString(36)}`;
    mutateCardDesign(() => {
      state.profile.design.layers.push({
        id, type: 'text', text: 'Your text', x: 420, y: 155, width: 130, height: 28, size: 28,
        color: '#f4f7f2', weight: 'bold', bold: true, italic: false, underline: false,
        fontFamily: 'sans', visible: true, rotation: 0,
      });
    });
    state.cardSelection = `layer:${id}`;
    renderCardStudio();
    elements.cardInspector.querySelector('textarea')?.focus();
  }

export function canvasPoint(event) {
    const box = elements.cardCanvasWrap.getBoundingClientRect();
    return { x: (event.clientX - box.left) * 1000 / box.width, y: (event.clientY - box.top) * 320 / box.height };
  }

export function hitCardSelection(point) {
    const choices = [
      ...state.profile.design.layers.map((layer) => `layer:${layer.id}`).reverse(),
      'rank', 'xp', 'progress', 'level', 'username', 'avatar', 'background',
    ];
    return choices.find((selection) => {
      const box = cardBounds(selection);
      return box && cardPointInBounds(point, box);
    }) || 'background';
  }

export function cardHandleAtPoint(point, bounds) {
    if (!bounds?.resize) return '';
    const controls = cardHandleMetrics(bounds);
    const rotate = cardRotateHandle(bounds);
    if (Math.hypot(point.x - rotate.x, point.y - rotate.y) <= controls.hitRadius) return 'rotate';
    return cardHandlePositions(bounds).find((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= controls.hitRadius)?.handle || '';
  }

export function cardAlignmentTargets(excludedSelection) {
    const x = [{ value: 0, kind: 'start' }, { value: 28, kind: 'start' }, { value: 500, kind: 'center' }, { value: 972, kind: 'end' }, { value: 1000, kind: 'end' }];
    const y = [{ value: 0, kind: 'start' }, { value: 28, kind: 'start' }, { value: 160, kind: 'center' }, { value: 292, kind: 'end' }, { value: 320, kind: 'end' }];
    const selections = [
      ...state.profile.design.layers.map((layer) => `layer:${layer.id}`),
      'avatar', 'username', 'level', 'rank', 'progress', 'xp',
    ];
    for (const selection of selections) {
      if (selection === excludedSelection) continue;
      const bounds = cardVisualBounds(cardBounds(selection));
      if (!bounds) continue;
      x.push({ value: bounds.x, kind: 'start' }, { value: bounds.x + bounds.width / 2, kind: 'center' }, { value: bounds.x + bounds.width, kind: 'end' });
      y.push({ value: bounds.y, kind: 'start' }, { value: bounds.y + bounds.height / 2, kind: 'center' }, { value: bounds.y + bounds.height, kind: 'end' });
    }
    return { x, y };
  }

export function cardSnapAxis(axis, bounds, targets, drag) {
    const origin = axis === 'x' ? bounds.x : bounds.y;
    const size = axis === 'x' ? bounds.width : bounds.height;
    const latchKey = axis === 'x' ? 'snapX' : 'snapY';
    const offsets = [{ value: 0, kind: 'start' }, { value: size / 2, kind: 'center' }, { value: size, kind: 'end' }];
    const latched = drag[latchKey];
    if (latched) {
      const difference = origin + latched.offset - latched.target;
      if (Math.abs(difference) <= CARD_SNAP_RELEASE) return { delta: -difference, guide: latched.target };
      drag[latchKey] = null;
    }
    let best = null;
    for (const offset of offsets) {
      for (const target of targets) {
        if (offset.kind !== target.kind) continue;
        const difference = origin + offset.value - target.value;
        if (Math.abs(difference) <= CARD_SNAP_DISTANCE && (!best || Math.abs(difference) < Math.abs(best.difference))) {
          best = { difference, offset: offset.value, target: target.value };
        }
      }
    }
    if (!best) return { delta: 0 };
    drag[latchKey] = { offset: best.offset, target: best.target };
    return { delta: -best.difference, guide: best.target };
  }

export function snapMovedCardTarget(drag) {
    const bounds = cardVisualBounds(cardBounds());
    if (!bounds) return;
    const targets = cardAlignmentTargets(state.cardSelection);
    const x = cardSnapAxis('x', bounds, targets.x, drag);
    const y = cardSnapAxis('y', bounds, targets.y, drag);
    if ('x' in drag.target) drag.target.x += x.delta;
    if ('y' in drag.target) drag.target.y += y.delta;
    state.cardGuides = { x: x.guide, y: y.guide };
  }

export function oppositeCardAnchor(bounds, handle) {
    const point = {
      x: handle.includes('e') ? bounds.x : handle.includes('w') ? bounds.x + bounds.width : bounds.x + bounds.width / 2,
      y: handle.includes('s') ? bounds.y : handle.includes('n') ? bounds.y + bounds.height : bounds.y + bounds.height / 2,
    };
    return rotateCardPoint(point, cardBoundsCenter(bounds), bounds.rotation);
  }

export function resizeCardTarget(drag, point) {
    const originalBounds = drag.bounds;
    const center = cardBoundsCenter(originalBounds);
    const local = rotateCardPoint(point, center, -originalBounds.rotation);
    const localX = local.x - originalBounds.x;
    const localY = local.y - originalBounds.y;
    const handle = drag.handle;
    let width = handle.includes('e') ? localX : handle.includes('w') ? originalBounds.width - localX : originalBounds.width;
    let height = handle.includes('s') ? localY : handle.includes('n') ? originalBounds.height - localY : originalBounds.height;
    width = Math.max(6, width);
    height = Math.max(6, height);
    const fixedAnchor = oppositeCardAnchor(originalBounds, handle);

    if (originalBounds.resize === 'text') {
      const scales = [];
      if (handle.includes('e') || handle.includes('w')) scales.push(width / originalBounds.width);
      if (handle.includes('n') || handle.includes('s')) scales.push(height / originalBounds.height);
      const scale = Math.max(.1, ...scales);
      const minimum = drag.target.type === 'text' ? 10 : 12;
      const maximum = drag.target.type === 'text' ? 96 : 80;
      drag.target.size = Math.round(Math.min(maximum, Math.max(minimum, drag.original.size * scale)));
    } else if (originalBounds.resize === 'square') {
      drag.target.size = Math.round(Math.max(32, Math.min(240, Math.max(width, height))));
    } else {
      drag.target.width = Math.round(Math.max(12, width));
      drag.target.height = Math.round(Math.max(state.cardSelection === 'progress' ? 6 : 12, height));
    }

    const resizedBounds = cardBounds();
    if (!resizedBounds) return;
    const movedAnchor = oppositeCardAnchor(resizedBounds, handle);
    if ('x' in drag.target) drag.target.x += fixedAnchor.x - movedAnchor.x;
    if ('y' in drag.target) drag.target.y += fixedAnchor.y - movedAnchor.y;
    constrainCardSelection();
  }

export function beginCardPointer(event) {
    if (!state.profile || event.button !== 0) return;
    const point = canvasPoint(event);
    const activeBounds = cardBounds();
    let handle = cardHandleAtPoint(point, activeBounds);
    if (!handle) {
      state.cardSelection = hitCardSelection(point);
      handle = cardHandleAtPoint(point, cardBounds());
    }
    const target = cardSelectionObject();
    const bounds = cardBounds();
    if (!target || !bounds) return;
    const center = cardBoundsCenter(bounds);
    state.cardPointer = {
      id: event.pointerId, start: point, handle, target, original: clone(target), bounds,
      mode: handle === 'rotate' ? 'rotate' : handle ? 'resize' : state.cardSelection === 'background' ? 'background' : 'move',
      startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      historySnapshot: cardSnapshot(),
    };
    state.cardGuides = {};
    elements.cardCanvasWrap.setPointerCapture(event.pointerId);
    renderCardLayers();
    renderCardInspector();
    scheduleCardDraw();
  }

export function moveCardPointer(event) {
    const drag = state.cardPointer;
    if (!drag || drag.id !== event.pointerId) return;
    const point = canvasPoint(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const target = drag.target;
    if (drag.mode === 'background') {
      if (target.imageUrl) { target.x = Math.round(drag.original.x + dx); target.y = Math.round(drag.original.y + dy); }
    } else if (drag.mode === 'rotate') {
      const center = cardBoundsCenter(drag.bounds);
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      let rotation = normalizedCardRotation(drag.original.rotation + (angle - drag.startAngle) * 180 / Math.PI);
      const snapped = Math.round(rotation / 15) * 15;
      if (event.shiftKey || Math.abs(rotation - snapped) <= 3) rotation = snapped;
      target.rotation = normalizedCardRotation(rotation);
      state.cardGuides = {};
    } else if (drag.mode === 'resize') {
      resizeCardTarget(drag, point);
      state.cardGuides = {};
    } else {
      if ('x' in target) target.x = Math.round(drag.original.x + dx);
      if ('y' in target) target.y = Math.round(drag.original.y + dy);
      constrainCardSelection();
      snapMovedCardTarget(drag);
    }
    if (drag.mode !== 'move' && drag.mode !== 'resize') constrainCardSelection();
    scheduleCardDraw();
    refreshCardDirty();
  }

export function endCardPointer(event) {
    if (!state.cardPointer || state.cardPointer.id !== event.pointerId) return;
    const historySnapshot = state.cardPointer.historySnapshot;
    state.cardPointer = null;
    state.cardGuides = {};
    commitCardHistory(historySnapshot);
    renderCardInspector();
    scheduleCardDraw();
    refreshCardDirty();
  }
