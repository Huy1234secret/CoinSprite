const { createCanvas } = require('@napi-rs/canvas');

const SUIT_CHARS = new Set(['♠', '♥', '♦', '♣']);
const RANK_TEXT = /^(?:A|[2-9]|10|J|Q|K)$/;
const STYLE_FLAG = '__coinspriteBlackjackCardStyleReady';

function installBlackjackCardStyle() {
  const context = createCanvas(1, 1).getContext('2d');
  const drawingContext = Object.getPrototypeOf(context);
  if (!drawingContext || drawingContext[STYLE_FLAG]) return;

  const fillTextBase = drawingContext.fillText;
  drawingContext.fillText = function fillTextWithBlackjackCardStyle(text, x, y, maxWidth) {
    const value = String(text ?? '');
    const font = String(this.font || '');

    if (this.textAlign === 'left' && this.textBaseline === 'top' && font === 'bold 24px sans-serif' && RANK_TEXT.test(value)) {
      const previousFont = this.font;
      this.font = value === '10' ? 'bold 28px sans-serif' : 'bold 32px sans-serif';
      const result = maxWidth === undefined
        ? fillTextBase.call(this, value, x + 1, y - 3)
        : fillTextBase.call(this, value, x + 1, y - 3, maxWidth);
      this.font = previousFont;
      return result;
    }

    if (this.textAlign === 'left' && this.textBaseline === 'top' && font === 'bold 28px sans-serif' && SUIT_CHARS.has(value)) {
      return undefined;
    }

    if (this.textAlign === 'center' && this.textBaseline === 'middle' && font === 'bold 56px sans-serif' && SUIT_CHARS.has(value)) {
      const previousFont = this.font;
      this.font = 'bold 64px sans-serif';
      const result = maxWidth === undefined
        ? fillTextBase.call(this, value, x, y + 2)
        : fillTextBase.call(this, value, x, y + 2, maxWidth);
      this.font = previousFont;
      return result;
    }

    return maxWidth === undefined
      ? fillTextBase.call(this, text, x, y)
      : fillTextBase.call(this, text, x, y, maxWidth);
  };

  Object.defineProperty(drawingContext, STYLE_FLAG, {
    value: true,
    configurable: false,
    enumerable: false,
  });
}

installBlackjackCardStyle();

module.exports = { installBlackjackCardStyle };
