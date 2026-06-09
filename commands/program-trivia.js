const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const GREEN_ACCENT = 0x57F287;
const RED_ACCENT = 0xED4245;
const BUTTON_STYLE_SECONDARY = 2;
const BUTTON_STYLE_SUCCESS = 3;
const BUTTON_STYLE_DANGER = 4;
const ANSWER_PREFIX = 'program-trivia:answer:';
const INPUT_PREFIX = 'program-trivia:input:';
const MODAL_PREFIX = 'program-trivia:modal:';
const OUTPUT_FIELD_ID = 'program_trivia_output';
const LETTERS = ['A', 'B', 'C', 'D'];
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const sessions = new Map();

const LANGUAGE_CHOICES = {
  c: { label: 'C', fence: 'c' },
  csharp: { label: 'C#', fence: 'csharp' },
  cpp: { label: 'C++', fence: 'cpp' },
  java: { label: 'Java', fence: 'java' },
};

const DIFFICULTY_CHOICES = {
  easy: { label: 'Easy' },
  medium: { label: 'Medium' },
  hard: { label: 'Hard' },
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(items) {
  return items[randInt(0, items.length - 1)];
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function uniqueChoices(answer, distractors) {
  const seen = new Set();
  const choices = [];
  for (const value of [answer, ...distractors]) {
    const text = String(value);
    if (seen.has(text)) continue;
    seen.add(text);
    choices.push(text);
    if (choices.length === 4) break;
  }

  let offset = 1;
  while (choices.length < 4) {
    const numericAnswer = Number(answer);
    const fallback = Number.isFinite(numericAnswer)
      ? String(numericAnswer + offset)
      : `${answer}${offset}`;
    if (!seen.has(fallback)) {
      seen.add(fallback);
      choices.push(fallback);
    }
    offset += 1;
  }
  return choices;
}

function linePrinter(language, expression) {
  if (language === 'c') return `    printf("%d\\n", ${expression});`;
  if (language === 'cpp') return `    cout << ${expression} << endl;`;
  if (language === 'csharp') return `        Console.WriteLine(${expression});`;
  return `        System.out.println(${expression});`;
}

function textPrinter(language, expression) {
  if (language === 'c') return `    printf("%s\\n", ${expression});`;
  if (language === 'cpp') return `    cout << ${expression} << endl;`;
  if (language === 'csharp') return `        Console.WriteLine(${expression});`;
  return `        System.out.println(${expression});`;
}

function intConcatPrinter(language, prefixExpression, valueExpression) {
  if (language === 'c') return `    printf("%s%d\\n", ${prefixExpression}, ${valueExpression});`;
  if (language === 'cpp') return `    cout << ${prefixExpression} << ${valueExpression} << endl;`;
  if (language === 'csharp') return `        Console.WriteLine(${prefixExpression} + ${valueExpression});`;
  return `        System.out.println(${prefixExpression} + ${valueExpression});`;
}

function wrapProgram(language, body, helpers = '') {
  if (language === 'c') {
    return [
      '#include <stdio.h>',
      '',
      helpers,
      'int main(void) {',
      body,
      '    return 0;',
      '}',
    ].filter(Boolean).join('\n');
  }

  if (language === 'cpp') {
    return [
      '#include <iostream>',
      'using namespace std;',
      '',
      helpers,
      'int main() {',
      body,
      '    return 0;',
      '}',
    ].filter(Boolean).join('\n');
  }

  if (language === 'csharp') {
    return [
      'using System;',
      '',
      'class Program {',
      helpers,
      '    static void Main() {',
      body,
      '    }',
      '}',
    ].filter(Boolean).join('\n');
  }

  return [
    'public class Main {',
    helpers,
    '    public static void main(String[] args) {',
    body,
    '    }',
    '}',
  ].filter(Boolean).join('\n');
}

function functionHelper(language, name, args, expression) {
  if (language === 'c' || language === 'cpp') {
    return `int ${name}(${args}) {\n    return ${expression};\n}\n`;
  }
  return `    static int ${name}(${args}) {\n        return ${expression};\n    }\n`;
}

function recursiveHelper(language) {
  if (language === 'c' || language === 'cpp') {
    return 'int mystery(int n) {\n    if (n <= 1) return n + 1;\n    return mystery(n - 1) + mystery(n - 2);\n}\n';
  }
  return '    static int mystery(int n) {\n        if (n <= 1) return n + 1;\n        return mystery(n - 1) + mystery(n - 2);\n    }\n';
}

function arrayLiteral(language, values) {
  const joined = values.join(', ');
  if (language === 'csharp') return `int[] numbers = { ${joined} };`;
  if (language === 'java') return `int[] numbers = { ${joined} };`;
  return `int numbers[] = { ${joined} };`;
}

function easyArithmetic(language) {
  const a = randInt(2, 8);
  const b = randInt(3, 9);
  const c = randInt(1, 5);
  const answer = a + (b * c);
  const body = [
    `    int a = ${a};`,
    `    int b = ${b};`,
    `    int c = ${c};`,
    linePrinter(language, 'a + b * c'),
  ].join('\n').replace(/^    /gm, language === 'csharp' || language === 'java' ? '        ' : '    ');
  return {
    code: wrapProgram(language, body),
    answer,
    distractors: [answer + a, (a + b) * c, answer - c, answer + 1],
  };
}

function easyLoop(language) {
  const n = randInt(4, 8);
  const start = randInt(1, 3);
  let total = 0;
  for (let i = start; i <= n; i += 1) total += i;
  const body = [
    `int total = 0;`,
    `for (int i = ${start}; i <= ${n}; i++) {`,
    '    total += i;',
    '}',
    linePrinter(language, 'total').trimStart(),
  ].map((line) => `${language === 'csharp' || language === 'java' ? '        ' : '    '}${line}`).join('\n');
  return {
    code: wrapProgram(language, body),
    answer: total,
    distractors: [total - start, total + n, total + 1, n * start],
  };
}

function easyText(language) {
  const coins = randInt(6, 14);
  const bonus = randInt(2, 7);
  const total = coins + bonus;
  const label = total >= 15 ? 'WIN' : 'TRY';
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  const body = [
    `int coins = ${coins};`,
    `int bonus = ${bonus};`,
    'int total = coins + bonus;',
    intConcatPrinter(language, 'total >= 15 ? "WIN:" : "TRY:"', 'total').trimStart(),
  ].map((line) => `${indent}${line}`).join('\n');
  const answer = `${label}:${total}`;
  return {
    code: wrapProgram(language, body),
    answer,
    distractors: [`${label}:${coins}`, `${label}:${total + 1}`, `${label === 'WIN' ? 'TRY' : 'WIN'}:${total}`, `${label}-${total}`],
  };
}

function mediumArray(language) {
  const values = Array.from({ length: 5 }, () => randInt(1, 9));
  let total = 0;
  for (const value of values) total += value % 2 === 0 ? value : -1;
  const body = [
    arrayLiteral(language, values),
    'int total = 0;',
    'for (int i = 0; i < numbers.length; i++) {',
    '    if (numbers[i] % 2 == 0) {',
    '        total += numbers[i];',
    '    } else {',
    '        total -= 1;',
    '    }',
    '}',
    linePrinter(language, 'total').trimStart(),
  ];
  if (language === 'c' || language === 'cpp') {
    body[2] = 'for (int i = 0; i < 5; i++) {';
  } else if (language === 'csharp') {
    body[2] = 'for (int i = 0; i < numbers.Length; i++) {';
  }
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  return {
    code: wrapProgram(language, body.map((line) => `${indent}${line}`).join('\n')),
    answer: total,
    distractors: [values.reduce((sum, value) => sum + value, 0), total + 2, total - 2, values.filter((value) => value % 2 === 0).length],
  };
}

function mediumText(language) {
  const base = randInt(3, 8);
  const values = [base, base + 2, base - 1, base + 4];
  let score = 0;
  for (let i = 0; i < values.length; i += 1) {
    score += i % 2 === 0 ? values[i] * 2 : values[i] - 1;
  }
  const label = score % 3 === 0 ? 'alpha' : score % 3 === 1 ? 'beta' : 'gamma';
  const body = [
    arrayLiteral(language, values),
    'int score = 0;',
    'for (int i = 0; i < numbers.length; i++) {',
    '    if (i % 2 == 0) {',
    '        score += numbers[i] * 2;',
    '    } else {',
    '        score += numbers[i] - 1;',
    '    }',
    '}',
    textPrinter(language, 'score % 3 == 0 ? "alpha" : score % 3 == 1 ? "beta" : "gamma"').trimStart(),
  ];
  if (language === 'c' || language === 'cpp') {
    body[2] = 'for (int i = 0; i < 4; i++) {';
  } else if (language === 'csharp') {
    body[2] = 'for (int i = 0; i < numbers.Length; i++) {';
  }
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  return {
    code: wrapProgram(language, body.map((line) => `${indent}${line}`).join('\n')),
    answer: label,
    distractors: ['alpha', 'beta', 'gamma', `${label}:${score}`],
  };
}

function mediumFunction(language) {
  const x = randInt(2, 5);
  const y = randInt(3, 8);
  const mix = (a, b) => (a * a) + b;
  const answer = mix(x, y) - mix(y, x);
  const helper = functionHelper(language, 'mix', 'int a, int b', 'a * a + b');
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  const body = [
    `int x = ${x};`,
    `int y = ${y};`,
    linePrinter(language, 'mix(x, y) - mix(y, x)').trimStart(),
  ].map((line) => `${indent}${line}`).join('\n');
  return {
    code: wrapProgram(language, body, helper),
    answer,
    distractors: [mix(x, y), mix(y, x), Math.abs(answer), answer + y],
  };
}

function hardNested(language) {
  const values = Array.from({ length: 6 }, () => randInt(3, 12));
  const adjust = (value, index) => (value % 2 === 0 ? value * (index + 1) : -(value + index));
  const fold = (current, value, index) => {
    const next = current + adjust(value, index);
    return next % 3 === 0 ? next + index : next - 1;
  };
  let score = 0;
  let flips = 0;
  for (let i = 0; i < values.length; i += 1) {
    score = fold(score, values[i], i);
    if (score % 5 === 0) {
      flips += i;
    } else {
      flips -= 1;
    }
  }
  const status = score > flips ? 'trace' : 'hold';
  const checksum = score + flips;
  const helper = language === 'c' || language === 'cpp'
    ? [
      'int adjust(int value, int index) {',
      '    if (value % 2 == 0) {',
      '        return value * (index + 1);',
      '    }',
      '    return -(value + index);',
      '}',
      '',
      'int foldScore(int current, int value, int index) {',
      '    int next = current + adjust(value, index);',
      '    if (next % 3 == 0) {',
      '        return next + index;',
      '    }',
      '    return next - 1;',
      '}',
      '',
    ].join('\n')
    : [
      '    static int adjust(int value, int index) {',
      '        if (value % 2 == 0) {',
      '            return value * (index + 1);',
      '        }',
      '        return -(value + index);',
      '    }',
      '',
      '    static int foldScore(int current, int value, int index) {',
      '        int next = current + adjust(value, index);',
      '        if (next % 3 == 0) {',
      '            return next + index;',
      '        }',
      '        return next - 1;',
      '    }',
      '',
    ].join('\n');
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  const statusType = language === 'java' ? 'String' : language === 'csharp' ? 'string' : 'const char *';
  const body = [
    arrayLiteral(language, values),
    'int score = 0;',
    'int flips = 0;',
    'for (int i = 0; i < 6; i++) {',
    '    score = foldScore(score, numbers[i], i);',
    '    if (score % 5 == 0) {',
    '        flips += i;',
    '    } else {',
    '        flips -= 1;',
    '    }',
    '}',
    `${statusType} status = score > flips ? "trace" : "hold";`,
    textPrinter(language, 'status').trimStart(),
    intConcatPrinter(language, '"checksum="', 'score + flips').trimStart(),
  ].map((line) => `${indent}${line}`).join('\n');
  return {
    code: wrapProgram(language, body, helper),
    answer: `${status}\nchecksum=${checksum}`,
    distractors: [`${status}\nchecksum=${score}`, `${status === 'trace' ? 'hold' : 'trace'}\nchecksum=${checksum}`, `${status}\nchecksum=${checksum + 1}`, String(checksum)],
  };
}

function hardRecursion(language) {
  const rows = 3;
  const cols = 4;
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => randInt(1, 9)));
  let total = 0;
  let diagonal = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const value = grid[r][c];
      if ((value + r + c) % 3 === 0) {
        total += value * (r + 1);
      } else {
        total -= c + 1;
      }
      if (r === c) diagonal += value;
    }
  }
  const finalScore = total + diagonal;
  const label = finalScore % 2 === 0 ? 'EVEN' : 'ODD';
  const matrixLiteral = language === 'csharp'
    ? `int[,] grid = { ${grid.map((row) => `{ ${row.join(', ')} }`).join(', ')} };`
    : language === 'java'
      ? `int[][] grid = { ${grid.map((row) => `{ ${row.join(', ')} }`).join(', ')} };`
      : `int grid[3][4] = { ${grid.map((row) => `{ ${row.join(', ')} }`).join(', ')} };`;
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  const access = language === 'csharp' ? 'grid[r, c]' : 'grid[r][c]';
  const labelType = language === 'java' ? 'String' : language === 'csharp' ? 'string' : 'const char *';
  const body = [
    matrixLiteral,
    'int total = 0;',
    'int diagonal = 0;',
    'for (int r = 0; r < 3; r++) {',
    '    for (int c = 0; c < 4; c++) {',
    `        int value = ${access};`,
    '        if ((value + r + c) % 3 == 0) {',
    '            total += value * (r + 1);',
    '        } else {',
    '            total -= c + 1;',
    '        }',
    '        if (r == c) {',
    '            diagonal += value;',
    '        }',
    '    }',
    '}',
    'int finalScore = total + diagonal;',
    `${labelType} label = finalScore % 2 == 0 ? "EVEN" : "ODD";`,
    textPrinter(language, 'label').trimStart(),
    intConcatPrinter(language, '"score="', 'finalScore').trimStart(),
  ].map((line) => `${indent}${line}`).join('\n');
  return {
    code: wrapProgram(language, body),
    answer: `${label}\nscore=${finalScore}`,
    distractors: [`${label}\nscore=${total}`, `${label === 'EVEN' ? 'ODD' : 'EVEN'}\nscore=${finalScore}`, `${label}\nscore=${finalScore + diagonal}`, String(finalScore)],
  };
}

const GENERATORS = {
  easy: [easyArithmetic, easyLoop, easyText],
  medium: [mediumArray, mediumFunction, mediumText],
  hard: [hardNested, hardRecursion],
};

function buildQuestion(language, difficulty) {
  const generator = pick(GENERATORS[difficulty] || GENERATORS.easy);
  const generated = generator(language);
  const isInputMode = difficulty === 'hard';
  const choices = isInputMode ? [] : shuffle(uniqueChoices(generated.answer, generated.distractors));
  const correctIndex = isInputMode ? -1 : choices.indexOf(String(generated.answer));
  return {
    language,
    difficulty,
    code: generated.code,
    mode: isInputMode ? 'input' : 'choice',
    choices,
    correctIndex,
    answer: String(generated.answer),
  };
}

function createSessionId(userId) {
  return `${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function triviaContainer(accent, components, flags = COMPONENTS_V2_FLAG) {
  return {
    flags,
    allowedMentions: { users: [] },
    components: [
      {
        type: 17,
        accent_color: accent,
        components,
      },
    ],
  };
}

function optionLines(question) {
  return question.choices.map((choice, index) => `**${LETTERS[index]}.** \`${choice}\``).join('\n');
}

function formatAnswer(answer) {
  return answer.includes('\n') ? `\n\`\`\`\n${answer}\n\`\`\`` : `\`${answer}\``;
}

function questionContent(question, expiresAt = null) {
  const language = LANGUAGE_CHOICES[question.language];
  const difficulty = DIFFICULTY_CHOICES[question.difficulty];
  const lines = [
    `## Program Trivia - ${language.label}`,
    `-# Difficulty: ${difficulty.label}`,
    expiresAt ? `-# Ends <t:${Math.floor(expiresAt / 1000)}:R>` : null,
    question.mode === 'input'
      ? 'Type the exact output of this full program.'
      : 'What is the exact output of this full program?',
    '',
    `\`\`\`${language.fence}`,
    question.code,
    '```',
  ].filter((line) => line !== null);

  if (question.mode === 'choice') {
    lines.push(optionLines(question));
  } else {
    lines.push('-# Hard mode uses typed answers. Press the button below and enter the exact output.');
  }

  return lines.join('\n');
}

function choiceResultContent(question, selectedIndex, expiresAt = null) {
  const selected = LETTERS[selectedIndex] || '?';
  const correct = LETTERS[question.correctIndex];
  const isCorrect = selectedIndex === question.correctIndex;
  return [
    questionContent(question, expiresAt),
    '',
    isCorrect
      ? `Correct. The answer is **${correct}**: \`${question.answer}\`.`
      : `Wrong. You picked **${selected}**. The correct answer is **${correct}**: \`${question.answer}\`.`,
  ].join('\n');
}

function inputResultContent(question, submittedAnswer, expiresAt = null) {
  const normalizedSubmitted = normalizeSubmittedAnswer(submittedAnswer);
  const isCorrect = normalizedSubmitted === normalizeSubmittedAnswer(question.answer);
  return [
    questionContent(question, expiresAt),
    '',
    isCorrect
      ? `Correct. The exact output is:${formatAnswer(question.answer)}`
      : `Wrong. Your answer was:${formatAnswer(normalizedSubmitted || '[blank]')}\nCorrect output:${formatAnswer(question.answer)}`,
  ].join('\n');
}

function timeoutContent(question, expiresAt = null) {
  return [
    questionContent(question, expiresAt),
    '',
    `Time is up. Correct output:${formatAnswer(question.answer)}`,
  ].join('\n');
}

function answerRows(sessionId, question, selectedIndex = null) {
  return [
    {
      type: 1,
      components: question.choices.map((choice, index) => {
        let style = BUTTON_STYLE_SECONDARY;
        if (selectedIndex !== null && index === question.correctIndex) style = BUTTON_STYLE_SUCCESS;
        if (selectedIndex !== null && index === selectedIndex && index !== question.correctIndex) style = BUTTON_STYLE_DANGER;
        return {
          type: 2,
          custom_id: `${ANSWER_PREFIX}${sessionId}:${index}`,
          label: LETTERS[index],
          style,
          disabled: selectedIndex !== null,
        };
      }),
    },
  ];
}

function inputRows(sessionId, disabled = false) {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: `${INPUT_PREFIX}${sessionId}`,
          label: 'Input Answer',
          style: BUTTON_STYLE_SECONDARY,
          disabled,
        },
      ],
    },
  ];
}

function controlsForQuestion(sessionId, question, done = false, selectedIndex = null) {
  if (question.mode === 'input') return inputRows(sessionId, done);
  return answerRows(sessionId, question, selectedIndex);
}

function questionPayload(sessionId, question, expiresAt) {
  return triviaContainer(WHITE_ACCENT, [
    { type: 10, content: questionContent(question, expiresAt) },
    { type: 14, divider: true, spacing: 1 },
    ...controlsForQuestion(sessionId, question),
  ]);
}

function choiceResultPayload(sessionId, question, selectedIndex, expiresAt) {
  return triviaContainer(selectedIndex === question.correctIndex ? GREEN_ACCENT : RED_ACCENT, [
    { type: 10, content: choiceResultContent(question, selectedIndex, expiresAt) },
    { type: 14, divider: true, spacing: 1 },
    ...answerRows(sessionId, question, selectedIndex),
  ]);
}

function inputResultPayload(sessionId, question, submittedAnswer, expiresAt) {
  const isCorrect = normalizeSubmittedAnswer(submittedAnswer) === normalizeSubmittedAnswer(question.answer);
  return triviaContainer(isCorrect ? GREEN_ACCENT : RED_ACCENT, [
    { type: 10, content: inputResultContent(question, submittedAnswer, expiresAt) },
    { type: 14, divider: true, spacing: 1 },
    ...inputRows(sessionId, true),
  ]);
}

function timeoutPayload(sessionId, question, expiresAt) {
  return triviaContainer(RED_ACCENT, [
    { type: 10, content: timeoutContent(question, expiresAt) },
    { type: 14, divider: true, spacing: 1 },
    ...controlsForQuestion(sessionId, question, true, question.correctIndex),
  ]);
}

function answerModal(sessionId) {
  return {
    custom_id: `${MODAL_PREFIX}${sessionId}`,
    title: 'Program trivia answer',
    components: [
      {
        type: 1,
        components: [
          {
            type: 4,
            custom_id: OUTPUT_FIELD_ID,
            label: 'Exact output',
            style: 2,
            required: true,
            min_length: 1,
            max_length: 500,
            placeholder: 'Type the exact output. For multiple lines, put each line on its own line.',
          },
        ],
      },
    ],
  };
}

function normalizeSubmittedAnswer(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function clearSessionTimer(session) {
  if (session?.timer) clearTimeout(session.timer);
  if (session) session.timer = null;
}

function deleteSession(sessionId) {
  const session = sessions.get(sessionId);
  clearSessionTimer(session);
  sessions.delete(sessionId);
  return session;
}

async function expireSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  deleteSession(sessionId);
  if (session.message?.editable) {
    await session.message.edit(timeoutPayload(sessionId, session.question, session.expiresAt)).catch(() => null);
  }
}

function startSessionTimer(sessionId, session) {
  clearSessionTimer(session);
  session.timer = setTimeout(() => {
    expireSession(sessionId).catch(() => null);
  }, SESSION_TIMEOUT_MS);
  if (typeof session.timer.unref === 'function') session.timer.unref();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('program-trivia')
    .setDescription('Answer a programming output trivia question.')
    .addStringOption((option) => option
      .setName('code-type')
      .setDescription('Programming language for the trivia program.')
      .setRequired(true)
      .addChoices(
        { name: 'C', value: 'c' },
        { name: 'C#', value: 'csharp' },
        { name: 'C++', value: 'cpp' },
        { name: 'Java', value: 'java' },
      ))
    .addStringOption((option) => option
      .setName('difficulty')
      .setDescription('Trivia difficulty.')
      .setRequired(true)
      .addChoices(
        { name: 'Easy', value: 'easy' },
        { name: 'Medium', value: 'medium' },
        { name: 'Hard', value: 'hard' },
      )),
  disableActionTimeout: true,

  async execute(interaction) {
    const language = interaction.options.getString('code-type');
    const difficulty = interaction.options.getString('difficulty');
    const question = buildQuestion(language, difficulty);
    const sessionId = createSessionId(interaction.user.id);
    const expiresAt = Date.now() + SESSION_TIMEOUT_MS;
    const session = {
      ownerId: interaction.user.id,
      question,
      expiresAt,
      createdAt: Date.now(),
      message: null,
      timer: null,
    };
    sessions.set(sessionId, session);
    await interaction.reply(questionPayload(sessionId, question, expiresAt));
    session.message = await interaction.fetchReply?.().catch(() => null);
    startSessionTimer(sessionId, session);
  },

  async handleInteraction(interaction) {
    if (interaction.isButton?.() && interaction.customId.startsWith(INPUT_PREFIX)) {
      const sessionId = interaction.customId.slice(INPUT_PREFIX.length);
      const session = sessions.get(sessionId);
      if (!session) {
        await interaction.reply({ content: 'This program trivia question is no longer active.', flags: EPHEMERAL_FLAG });
        return true;
      }

      if (session.ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'Only the player who started this program trivia can answer it.', flags: EPHEMERAL_FLAG });
        return true;
      }

      if (interaction.message) session.message = interaction.message;
      await interaction.showModal(answerModal(sessionId));
      return true;
    }

    if (interaction.isModalSubmit?.() && interaction.customId.startsWith(MODAL_PREFIX)) {
      const sessionId = interaction.customId.slice(MODAL_PREFIX.length);
      const session = sessions.get(sessionId);
      if (!session) {
        await interaction.reply({ content: 'This program trivia question is no longer active.', flags: EPHEMERAL_FLAG });
        return true;
      }

      if (session.ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'Only the player who started this program trivia can answer it.', flags: EPHEMERAL_FLAG });
        return true;
      }

      const submittedAnswer = interaction.fields.getTextInputValue(OUTPUT_FIELD_ID);
      deleteSession(sessionId);
      await interaction.reply({ content: 'Answer submitted.', flags: EPHEMERAL_FLAG });
      if (session.message?.editable) {
        await session.message.edit(inputResultPayload(sessionId, session.question, submittedAnswer, session.expiresAt)).catch(() => null);
      }
      return true;
    }

    if (!interaction.isButton?.() || !interaction.customId.startsWith(ANSWER_PREFIX)) return false;

    const rest = interaction.customId.slice(ANSWER_PREFIX.length);
    const separator = rest.lastIndexOf(':');
    const sessionId = rest.slice(0, separator);
    const selectedIndex = Number(rest.slice(separator + 1));
    const session = sessions.get(sessionId);

    if (!session) {
      await interaction.reply({ content: 'This program trivia question is no longer active.', flags: EPHEMERAL_FLAG });
      return true;
    }

    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the player who started this program trivia can answer it.', flags: EPHEMERAL_FLAG });
      return true;
    }

    deleteSession(sessionId);
    await interaction.update(choiceResultPayload(sessionId, session.question, selectedIndex, session.expiresAt));
    return true;
  },
};
