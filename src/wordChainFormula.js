const DEFAULT_WORD_CHAIN_XP_FORMULA = 'wordLength';
const MAX_FORMULA_LENGTH = 120;
const MAX_TOKENS = 128;
const MAX_DEPTH = 32;
const MAX_XP_REWARD = 100000;

const FUNCTIONS = {
  abs: { args: 1, run: Math.abs },
  ceil: { args: 1, run: Math.ceil },
  floor: { args: 1, run: Math.floor },
  max: { args: 2, run: Math.max },
  min: { args: 2, run: Math.min },
  round: { args: 1, run: Math.round },
};

function tokenize(formula) {
  const source = String(formula ?? '').trim();
  if (!source || source.length > MAX_FORMULA_LENGTH) throw new Error('Invalid formula length.');

  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) throw new Error('Invalid number.');
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new Error('Invalid number.');
      tokens.push({ type: 'number', value });
      index += match[0].length;
    } else if (/[A-Za-z_]/.test(char)) {
      const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      tokens.push({ type: 'identifier', value: match[0] });
      index += match[0].length;
    } else if ('+-*/%(),'.includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
    } else {
      throw new Error('Unsupported character.');
    }

    if (tokens.length > MAX_TOKENS) throw new Error('Formula is too complex.');
  }
  return tokens;
}

function evaluateFormula(formula, variables = {}) {
  const tokens = tokenize(formula);
  let index = 0;

  function peek(type) {
    return tokens[index]?.type === type;
  }

  function consume(type) {
    if (!peek(type)) throw new Error(`Expected ${type}.`);
    return tokens[index++];
  }

  function parseExpression(depth = 0) {
    if (depth > MAX_DEPTH) throw new Error('Formula is too deeply nested.');
    let value = parseTerm(depth + 1);
    while (peek('+') || peek('-')) {
      const operator = tokens[index++].type;
      const right = parseTerm(depth + 1);
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(depth) {
    let value = parseUnary(depth + 1);
    while (peek('*') || peek('/') || peek('%')) {
      const operator = tokens[index++].type;
      const right = parseUnary(depth + 1);
      if ((operator === '/' || operator === '%') && right === 0) throw new Error('Division by zero.');
      if (operator === '*') value *= right;
      else if (operator === '/') value /= right;
      else value %= right;
    }
    return value;
  }

  function parseUnary(depth) {
    if (peek('+')) {
      consume('+');
      return parseUnary(depth + 1);
    }
    if (peek('-')) {
      consume('-');
      return -parseUnary(depth + 1);
    }
    return parsePrimary(depth + 1);
  }

  function parsePrimary(depth) {
    if (depth > MAX_DEPTH) throw new Error('Formula is too deeply nested.');
    if (peek('number')) return consume('number').value;
    if (peek('(')) {
      consume('(');
      const value = parseExpression(depth + 1);
      consume(')');
      return value;
    }
    if (!peek('identifier')) throw new Error('Expected a number or variable.');

    const name = consume('identifier').value;
    if (!peek('(')) {
      if (!Object.prototype.hasOwnProperty.call(variables, name)) throw new Error(`Unknown variable ${name}.`);
      const value = Number(variables[name]);
      if (!Number.isFinite(value)) throw new Error(`Invalid variable ${name}.`);
      return value;
    }

    const definition = FUNCTIONS[name];
    if (!definition) throw new Error(`Unknown function ${name}.`);
    consume('(');
    const args = [];
    if (!peek(')')) {
      args.push(parseExpression(depth + 1));
      while (peek(',')) {
        consume(',');
        args.push(parseExpression(depth + 1));
      }
    }
    consume(')');
    if (args.length !== definition.args) throw new Error(`${name} expects ${definition.args} argument(s).`);
    return definition.run(...args);
  }

  const result = parseExpression();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error('Invalid formula.');
  return result;
}

function isValidWordChainXpFormula(formula) {
  try {
    evaluateFormula(formula, { wordLength: 8, streak: 12 });
    return true;
  } catch {
    return false;
  }
}

function sanitizeWordChainXpFormula(formula) {
  const clean = String(formula ?? '').trim();
  return isValidWordChainXpFormula(clean) ? clean : DEFAULT_WORD_CHAIN_XP_FORMULA;
}

function calculateWordChainXp(formula, variables) {
  const safeFormula = sanitizeWordChainXpFormula(formula);
  try {
    const value = evaluateFormula(safeFormula, variables);
    if (!Number.isFinite(value) || value < 0) throw new Error('XP must be a non-negative number.');
    return Math.min(MAX_XP_REWARD, value);
  } catch {
    return Math.max(0, Math.min(MAX_XP_REWARD, Number(variables?.wordLength) || 0));
  }
}

module.exports = {
  DEFAULT_WORD_CHAIN_XP_FORMULA,
  calculateWordChainXp,
  evaluateFormula,
  isValidWordChainXpFormula,
  sanitizeWordChainXpFormula,
};
