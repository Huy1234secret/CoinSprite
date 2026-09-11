const { randomInt } = require('node:crypto');

// Original questions stay first so persisted seen indices retain their meaning.
// The first answer in each source row is correct; choices are shuffled for display.
const BANK = {
  easy: [
    ['Which planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Neptune'],
    ['How many sides does a hexagon have?', '6', '5', '7', '8'],
    ['Which ocean is the largest?', 'Pacific', 'Atlantic', 'Indian', 'Arctic'],
    ['What gas do plants absorb during photosynthesis?', 'Carbon dioxide', 'Oxygen', 'Helium', 'Hydrogen'],
    ['What is the capital of Japan?', 'Tokyo', 'Kyoto', 'Seoul', 'Beijing'],
    ['Which animal is a mammal?', 'Dolphin', 'Shark', 'Trout', 'Octopus'],
    ['How many minutes are in two hours?', '120', '100', '90', '180'],
    ['Which instrument has black and white keys?', 'Piano', 'Flute', 'Trumpet', 'Violin'],
    ['Which shape has three sides?', 'Triangle', 'Square', 'Pentagon', 'Circle'],
    ['What is frozen water called?', 'Ice', 'Steam', 'Salt', 'Sand'],
    ['Which star is closest to Earth?', 'The Sun', 'Sirius', 'Polaris', 'Vega'],
    ['How many days are in a leap year?', '366', '365', '364', '367'],
    ['Which organ pumps blood?', 'Heart', 'Liver', 'Lung', 'Stomach'],
    ['Which continent contains Egypt?', 'Africa', 'Europe', 'South America', 'Australia'],
    ['What is the chemical formula for water?', 'H2O', 'CO2', 'O2', 'NaCl'],
  ],
  medium: [
    ['Which element has the symbol Fe?', 'Iron', 'Fluorine', 'Francium', 'Lead'],
    ['Who wrote Pride and Prejudice?', 'Jane Austen', 'Charlotte Bronte', 'Mary Shelley', 'George Eliot'],
    ['Which city was the capital of the Byzantine Empire?', 'Constantinople', 'Athens', 'Alexandria', 'Venice'],
    ['What is the largest internal human organ?', 'Liver', 'Heart', 'Kidney', 'Pancreas'],
    ['What is the square root of 144?', '12', '14', '16', '18'],
    ['Which layer lies directly below Earth\'s crust?', 'Mantle', 'Outer core', 'Inner core', 'Atmosphere'],
    ['Which country contains Machu Picchu?', 'Peru', 'Chile', 'Mexico', 'Bolivia'],
    ['What is the SI unit of electrical resistance?', 'Ohm', 'Volt', 'Ampere', 'Watt'],
    ['Who painted The Starry Night?', 'Vincent van Gogh', 'Claude Monet', 'Pablo Picasso', 'Salvador Dali'],
    ['Which blood cells carry oxygen?', 'Red blood cells', 'Platelets', 'White blood cells', 'Stem cells'],
    ['Which language has the most native speakers worldwide?', 'Mandarin Chinese', 'English', 'Spanish', 'Arabic'],
    ['What is the smallest prime number?', '2', '1', '0', '3'],
    ['What type of rock forms from cooled lava?', 'Igneous', 'Sedimentary', 'Metamorphic', 'Chalk'],
    ['Which moon orbits Saturn?', 'Titan', 'Europa', 'Phobos', 'Triton'],
    ['What does the prefix kilo- mean in SI units?', 'One thousand', 'One hundred', 'One million', 'One tenth'],
  ],
  hard: [
    ['Which element has atomic number 74?', 'Tungsten', 'Tantalum', 'Rhenium', 'Osmium'],
    ['Who proved the incompleteness theorems?', 'Kurt Godel', 'Alan Turing', 'David Hilbert', 'Georg Cantor'],
    ['Which treaty ended the Thirty Years\' War in 1648?', 'Peace of Westphalia', 'Treaty of Utrecht', 'Treaty of Paris', 'Treaty of Tordesillas'],
    ['What is the SI unit of magnetic flux?', 'Weber', 'Tesla', 'Henry', 'Farad'],
    ['Which enzyme synthesizes RNA from a DNA template?', 'RNA polymerase', 'DNA ligase', 'Helicase', 'Pepsin'],
    ['Who wrote The Master and Margarita?', 'Mikhail Bulgakov', 'Leo Tolstoy', 'Anton Chekhov', 'Ivan Turgenev'],
    ['Which moon has a retrograde orbit around Neptune?', 'Triton', 'Nereid', 'Proteus', 'Larissa'],
    ['What is the derivative of ln(x) for x > 0?', '1/x', 'x', 'ln(x)/x', 'e^x'],
    ['Which civilization used the Linear B script?', 'Mycenaean Greeks', 'Phoenicians', 'Etruscans', 'Sumerians'],
    ['What is the capital of Bhutan?', 'Thimphu', 'Paro', 'Kathmandu', 'Dhaka'],
    ['Which particle mediates the strong interaction?', 'Gluon', 'Photon', 'W boson', 'Neutrino'],
    ['Which composer wrote the opera Wozzeck?', 'Alban Berg', 'Anton Webern', 'Gustav Mahler', 'Richard Strauss'],
    ['Which vitamin is also called cobalamin?', 'B12', 'B6', 'B1', 'B9'],
    ['What is the sum of the interior angles of a decagon?', '1440 degrees', '1260 degrees', '1620 degrees', '1800 degrees'],
    ['Which mathematician introduced the famous seven bridges of Konigsberg solution?', 'Leonhard Euler', 'Carl Gauss', 'Pierre Fermat', 'Blaise Pascal'],
  ],
};
// Imported questions are bundled locally; playing never calls an external API.
// Attribution and licensing: data/ATTRIBUTION.md.
for (const difficulty of Object.keys(BANK)) {
  BANK[difficulty].push(...require(`./data/${difficulty}.json`));
}
function question(difficulty, seen = [], random = randomInt) {
  const bank = BANK[difficulty];
  let available = bank.map((_, i) => i).filter(i => !seen.includes(i));
  if (!available.length) { seen = []; available = bank.map((_, i) => i); }
  const id = available[random(available.length)];
  const [text, correct, ...wrong] = bank[id];
  const answers = [correct, ...wrong];
  for (let i = answers.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }
  return { text, answers, correct: answers.indexOf(correct), seen: [...seen, id] };
}
module.exports = { BANK, question };
