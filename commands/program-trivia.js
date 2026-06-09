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
const LETTERS = ['A', 'B', 'C', 'D'];
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
    const fallback = String(Number(answer) + offset);
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
  }
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  return {
    code: wrapProgram(language, body.map((line) => `${indent}${line}`).join('\n')),
    answer: total,
    distractors: [values.reduce((sum, value) => sum + value, 0), total + 2, total - 2, values.filter((value) => value % 2 === 0).length],
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
  const outer = randInt(3, 4);
  const inner = randInt(3, 5);
  let total = 0;
  for (let i = 1; i <= outer; i += 1) {
    for (let j = 1; j <= inner; j += 1) {
      total += (i + j) % 2 === 0 ? i * j : -j;
    }
  }
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  const body = [
    'int total = 0;',
    `for (int i = 1; i <= ${outer}; i++) {`,
    `    for (int j = 1; j <= ${inner}; j++) {`,
    '        if ((i + j) % 2 == 0) {',
    '            total += i * j;',
    '        } else {',
    '            total -= j;',
    '        }',
    '    }',
    '}',
    linePrinter(language, 'total').trimStart(),
  ].map((line) => `${indent}${line}`).join('\n');
  return {
    code: wrapProgram(language, body),
    answer: total,
    distractors: [total + outer, total - inner, outer * inner, total * -1],
  };
}

function hardRecursion(language) {
  const n = randInt(4, 6);
  const mystery = (value) => {
    if (value <= 1) return value + 1;
    return mystery(value - 1) + mystery(value - 2);
  };
  const answer = mystery(n);
  const indent = language === 'csharp' || language === 'java' ? '        ' : '    ';
  const body = `${indent}${linePrinter(language, `mystery(${n})`).trimStart()}`;
  return {
    code: wrapProgram(language, body, recursiveHelper(language)),
    answer,
    distractors: [answer - 1, answer + 1, answer + n, n * n],
  };
}

const GENERATORS = {
  easy: [easyArithmetic, easyLoop],
  medium: [mediumArray, mediumFunction],
  hard: [hardNested, hardRecursion],
};

function buildQuestion(language, difficulty) {
  const generator = pick(GENERATORS[difficulty] || GENERATORS.easy);
  const generated = generator(language);
  const choices = shuffle(uniqueChoices(generated.answer, generated.distractors));
  const correctIndex = choices.indexOf(String(generated.answer));
  return {
    language,
    difficulty,
    code: generated.code,
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

function questionContent(question) {
  const language = LANGUAGE_CHOICES[question.language];
  const difficulty = DIFFICULTY_CHOICES[question.difficulty];
  return [
    `## Program Trivia - ${language.label}`,
    `-# Difficulty: ${difficulty.label}`,
    'What is the exact output of this full program?',
    '',
    `\`\`\`${language.fence}`,
    question.code,
    '```',
    optionLines(question),
  ].join('\n');
}

function resultContent(question, selectedIndex) {
  const selected = LETTERS[selectedIndex] || '?';
  const correct = LETTERS[question.correctIndex];
  const isCorrect = selectedIndex === question.correctIndex;
  return [
    questionContent(question),
    '',
    isCorrect
      ? `Correct. The answer is **${correct}**: \`${question.answer}\`.`
      : `Wrong. You picked **${selected}**. The correct answer is **${correct}**: \`${question.answer}\`.`,
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

function questionPayload(sessionId, question) {
  return triviaContainer(WHITE_ACCENT, [
    { type: 10, content: questionContent(question) },
    { type: 14, divider: true, spacing: 1 },
    ...answerRows(sessionId, question),
  ]);
}

function resultPayload(sessionId, question, selectedIndex) {
  return triviaContainer(selectedIndex === question.correctIndex ? GREEN_ACCENT : RED_ACCENT, [
    { type: 10, content: resultContent(question, selectedIndex) },
    { type: 14, divider: true, spacing: 1 },
    ...answerRows(sessionId, question, selectedIndex),
  ]);
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

  async execute(interaction) {
    const language = interaction.options.getString('code-type');
    const difficulty = interaction.options.getString('difficulty');
    const question = buildQuestion(language, difficulty);
    const sessionId = createSessionId(interaction.user.id);
    sessions.set(sessionId, {
      ownerId: interaction.user.id,
      question,
      createdAt: Date.now(),
    });
    await interaction.reply(questionPayload(sessionId, question));
  },

  async handleInteraction(interaction) {
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

    sessions.delete(sessionId);
    await interaction.update(resultPayload(sessionId, session.question, selectedIndex));
    return true;
  },
};
