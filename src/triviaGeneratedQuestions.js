function hashSeed(text) {
  return [...text].reduce((acc, ch) => ((acc * 33) + ch.charCodeAt(0)) >>> 0, 5381);
}

function buildQuestion(question, correct, incorrect) {
  const answers = [correct, ...incorrect];
  const seed = hashSeed(question);
  for (let i = answers.length - 1; i > 0; i -= 1) {
    const j = (seed + (i * 13)) % (i + 1);
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }

  return {
    question,
    answers,
    correctIndex: answers.indexOf(correct),
  };
}

function createEasyQuestions(count) {
  const questions = [];
  for (let i = 1; i <= count; i += 1) {
    const a = (i % 20) + 1;
    const b = ((i * 3) % 20) + 1;
    const correct = String(a + b);
    questions.push(buildQuestion(
      `Easy Math #${i}: What is ${a} + ${b}?`,
      correct,
      [String((a + b) + 1), String(Math.max(0, (a + b) - 1)), String((a + b) + 2)],
    ));
  }
  return questions;
}

function createMediumQuestions(count) {
  const questions = [];
  for (let i = 1; i <= count; i += 1) {
    const a = ((i * 7) % 40) + 10;
    const b = ((i * 5) % 25) + 5;
    const total = a * b;
    questions.push(buildQuestion(
      `Medium Math #${i}: What is ${a} × ${b}?`,
      String(total),
      [String(total + a), String(total - b), String(total + b)],
    ));
  }
  return questions;
}

function createHardQuestions(count) {
  const questions = [];
  for (let i = 1; i <= count; i += 1) {
    const base = (i % 12) + 2;
    const exponent = (i % 4) + 2;
    const correct = String(base ** exponent);
    questions.push(buildQuestion(
      `Hard Math #${i}: What is ${base}^${exponent}?`,
      correct,
      [String((base ** exponent) + base), String((base ** exponent) - exponent), String((base ** exponent) + exponent)],
    ));
  }
  return questions;
}

module.exports = {
  easy: createEasyQuestions(200),
  medium: createMediumQuestions(200),
  hard: createHardQuestions(200),
};
