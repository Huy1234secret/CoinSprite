function shuffleOptions(correct, wrong) {
  const options = [correct, ...wrong];
  const seed = String(correct).length + wrong.join('').length;
  const correctIndex = seed % 4;
  [options[0], options[correctIndex]] = [options[correctIndex], options[0]];
  return [options, correctIndex];
}

function question(prompt, correct, wrong) {
  const [answers, correctIndex] = shuffleOptions(correct, wrong);
  return [prompt, answers, correctIndex];
}

function uniqueWrongNumber(correct, spread = 10) {
  const values = new Set();
  let offset = 1;
  while (values.size < 3) {
    values.add(String(correct + offset));
    if (values.size < 3 && correct - offset >= 0) values.add(String(correct - offset));
    offset += Math.max(1, Math.floor(spread / 3));
  }
  return Array.from(values).slice(0, 3);
}

const easy = [];
for (let n = 1; n <= 34; n += 1) {
  const answer = n + 10;
  easy.push(question(`Easy math: what is ${n} + 10?`, String(answer), uniqueWrongNumber(answer, 6)));
}
for (let n = 1; n <= 34; n += 1) {
  const answer = n * 2;
  easy.push(question(`Easy math: what is double ${n}?`, String(answer), uniqueWrongNumber(answer, 8)));
}
for (let n = 20; n <= 53; n += 1) {
  const answer = n - 5;
  easy.push(question(`Easy math: what is ${n} - 5?`, String(answer), uniqueWrongNumber(answer, 6)));
}
const easyFacts = [
  ['Which gas do humans need to breathe?', 'Oxygen', ['Helium', 'Neon', 'Argon']],
  ['Which planet is closest to the Sun?', 'Mercury', ['Mars', 'Saturn', 'Neptune']],
  ['What is the largest land animal?', 'Elephant', ['Tiger', 'Gorilla', 'Camel']],
  ['What do you call a frozen dessert on a stick?', 'Popsicle', ['Pretzel', 'Sandwich', 'Pancake']],
  ['Which shape has no corners?', 'Circle', ['Square', 'Triangle', 'Rectangle']],
  ['What do you call the center of an apple?', 'Core', ['Shell', 'Crust', 'Stem only']],
  ['Which sense uses your ears?', 'Hearing', ['Taste', 'Touch', 'Sight']],
  ['Which animal is known for its pouch?', 'Kangaroo', ['Penguin', 'Tiger', 'Zebra']],
  ['What is the opposite of empty?', 'Full', ['Tiny', 'Sharp', 'Quiet']],
  ['Which natural object lights Earth during the day?', 'Sun', ['Moon', 'Comet', 'Cloud']],
  ['What do you call the person who flies an airplane?', 'Pilot', ['Chef', 'Dentist', 'Farmer']],
  ['Which tool is used to dig soil?', 'Shovel', ['Needle', 'Fork', 'Brush']],
  ['What is the main color of a stop sign?', 'Red', ['Blue', 'Green', 'Purple']],
  ['Which animal is famous for black and white stripes?', 'Zebra', ['Horse', 'Deer', 'Goat']],
  ['What does a compass help you find?', 'Direction', ['Temperature', 'Weight', 'Sound']],
  ['Which month has Halloween in many countries?', 'October', ['April', 'June', 'December']],
  ['What food do bees help plants make by pollinating flowers?', 'Fruit', ['Stone', 'Glass', 'Metal']],
  ['Which place is full of trees?', 'Forest', ['Desert', 'Kitchen', 'Airport']],
  ['Which liquid comes from cows and is often drunk?', 'Milk', ['Juice', 'Oil', 'Vinegar']],
  ['Which item protects your eyes from bright sun?', 'Sunglasses', ['Mittens', 'Scarf', 'Belt']],
  ['What do you call a baby chicken?', 'Chick', ['Cub', 'Calf', 'Foal']],
  ['Which animal is known for changing color?', 'Chameleon', ['Horse', 'Cow', 'Panda']],
  ['What is the opposite of clean?', 'Dirty', ['Soft', 'Round', 'Bright']],
  ['Which vehicle usually has wings?', 'Airplane', ['Bus', 'Bicycle', 'Train']],
  ['What do you call a house made of snow blocks?', 'Igloo', ['Cabin', 'Tent', 'Barn']],
  ['Which fruit is often dried to make raisins?', 'Grape', ['Apple', 'Orange', 'Peach']],
  ['What does a calendar show?', 'Dates', ['Recipes', 'Passwords', 'Paint colors']],
  ['Which animal is known for its humps?', 'Camel', ['Rabbit', 'Dog', 'Sheep']],
  ['Which object is used to tell direction and has a needle?', 'Compass', ['Thermometer', 'Scale', 'Timer']],
  ['What do you call water vapor in the sky?', 'Cloud', ['Rock', 'Leaf', 'Coin']],
  ['Which food is made from cacao beans?', 'Chocolate', ['Cheese', 'Bread', 'Pickles']],
  ['What is a baby horse called?', 'Foal', ['Kitten', 'Puppy', 'Chick']]
];
for (const [prompt, correct, wrong] of easyFacts) easy.push(question(prompt, correct, wrong));

const medium = [];
for (let n = 12; n <= 44; n += 1) {
  const answer = n * 3;
  medium.push(question(`Medium math: what is ${n} × 3?`, String(answer), uniqueWrongNumber(answer, 12)));
}
for (let n = 15; n <= 47; n += 1) {
  const answer = n * 4;
  medium.push(question(`Medium math: what is ${n} × 4?`, String(answer), uniqueWrongNumber(answer, 16)));
}
for (let n = 60; n <= 92; n += 1) {
  const answer = n - 17;
  medium.push(question(`Medium math: what is ${n} - 17?`, String(answer), uniqueWrongNumber(answer, 10)));
}
const mediumFacts = [
  ['What is the capital of Canada?', 'Ottawa', ['Toronto', 'Vancouver', 'Montreal']],
  ['What is the capital of Australia?', 'Canberra', ['Sydney', 'Melbourne', 'Perth']],
  ['Which element has the chemical symbol Fe?', 'Iron', ['Fluorine', 'Francium', 'Fermium']],
  ['Which organ pumps blood through the body?', 'Heart', ['Liver', 'Kidney', 'Lung']],
  ['Which layer of Earth is made mostly of solid rock and soil at the surface?', 'Crust', ['Core', 'Mantle', 'Outer core']],
  ['What is the process plants use to make food from light?', 'Photosynthesis', ['Evaporation', 'Condensation', 'Erosion']],
  ['Which continent is Egypt mostly located in?', 'Africa', ['Asia', 'Europe', 'South America']],
  ['Which ocean is the largest?', 'Pacific Ocean', ['Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean']],
  ['Who wrote the play Romeo and Juliet?', 'William Shakespeare', ['Charles Dickens', 'Mark Twain', 'Jane Austen']],
  ['What is the hardest natural substance on Earth?', 'Diamond', ['Quartz', 'Granite', 'Iron']],
  ['Which planet is known for its rings?', 'Saturn', ['Mercury', 'Mars', 'Venus']],
  ['What is the largest mammal?', 'Blue whale', ['Elephant', 'Giraffe', 'Hippopotamus']],
  ['Which country is famous for the ancient city of Machu Picchu?', 'Peru', ['Chile', 'Mexico', 'Spain']],
  ['Which blood cells help fight infection?', 'White blood cells', ['Red blood cells', 'Platelets', 'Plasma']],
  ['Which force keeps planets in orbit around the Sun?', 'Gravity', ['Magnetism', 'Friction', 'Electricity']],
  ['What is the boiling point of water at sea level in Celsius?', '100°C', ['50°C', '75°C', '150°C']],
  ['Which language is primarily spoken in Brazil?', 'Portuguese', ['Spanish', 'French', 'Italian']],
  ['What is the name of the galaxy that contains Earth?', 'Milky Way', ['Andromeda', 'Sombrero', 'Whirlpool']],
  ['Which scientist proposed the theory of relativity?', 'Albert Einstein', ['Isaac Newton', 'Galileo Galilei', 'Marie Curie']],
  ['What is the largest desert in the world by area?', 'Antarctic Desert', ['Sahara Desert', 'Gobi Desert', 'Kalahari Desert']],
  ['Which Roman numeral means 50?', 'L', ['X', 'C', 'D']],
  ['Which country gifted the Statue of Liberty to the United States?', 'France', ['Spain', 'Italy', 'Germany']],
  ['Which part of the cell contains most genetic material?', 'Nucleus', ['Ribosome', 'Cell wall', 'Mitochondrion']],
  ['Which gas makes up most of Earth’s atmosphere?', 'Nitrogen', ['Oxygen', 'Carbon dioxide', 'Hydrogen']],
  ['Which mountain is the tallest above sea level?', 'Mount Everest', ['K2', 'Kilimanjaro', 'Denali']],
  ['Which ancient civilization built the pyramids at Giza?', 'Ancient Egyptians', ['Romans', 'Vikings', 'Mayans']],
  ['Which instrument measures atmospheric pressure?', 'Barometer', ['Thermometer', 'Hygrometer', 'Anemometer']],
  ['What is the smallest prime number?', '2', ['1', '3', '0']],
  ['Which country has the city Kyoto?', 'Japan', ['China', 'South Korea', 'Thailand']],
  ['Which vitamin is produced by skin exposed to sunlight?', 'Vitamin D', ['Vitamin A', 'Vitamin C', 'Vitamin K']],
  ['Which river is commonly considered the longest in the world?', 'Nile', ['Amazon', 'Yangtze', 'Mississippi']],
  ['Which body system includes the brain and spinal cord?', 'Nervous system', ['Digestive system', 'Respiratory system', 'Skeletal system']],
  ['What does DNA stand for?', 'Deoxyribonucleic acid', ['Digital numeric acid', 'Dual nitrogen atom', 'Dense neural array']],
  ['Which country is home to the city of Marrakech?', 'Morocco', ['Turkey', 'Greece', 'India']]
];
for (const [prompt, correct, wrong] of mediumFacts) medium.push(question(prompt, correct, wrong));

const hard = [];
for (let n = 14; n <= 46; n += 1) {
  const answer = n * n;
  hard.push(question(`Hard math: what is ${n} squared?`, String(answer), uniqueWrongNumber(answer, 20)));
}
for (let n = 25; n <= 57; n += 1) {
  const answer = n * 7;
  hard.push(question(`Hard math: what is ${n} × 7?`, String(answer), uniqueWrongNumber(answer, 21)));
}
for (let n = 144; n <= 176; n += 1) {
  const answer = n - 89;
  hard.push(question(`Hard math: what is ${n} - 89?`, String(answer), uniqueWrongNumber(answer, 15)));
}
const hardFacts = [
  ['Which treaty ended World War I?', 'Treaty of Versailles', ['Treaty of Paris', 'Treaty of Tordesillas', 'Treaty of Ghent']],
  ['Which scientist discovered penicillin?', 'Alexander Fleming', ['Louis Pasteur', 'Robert Koch', 'Joseph Lister']],
  ['What is the SI unit of electric resistance?', 'Ohm', ['Volt', 'Ampere', 'Watt']],
  ['Which mathematician is associated with the incompleteness theorems?', 'Kurt Gödel', ['Alan Turing', 'David Hilbert', 'Georg Cantor']],
  ['What is the capital of Kazakhstan?', 'Astana', ['Almaty', 'Tashkent', 'Bishkek']],
  ['Which element has atomic number 79?', 'Gold', ['Silver', 'Platinum', 'Mercury']],
  ['Which moon is the largest moon of Saturn?', 'Titan', ['Europa', 'Ganymede', 'Callisto']],
  ['Which empire used the administrative system called satrapies?', 'Achaemenid Empire', ['Roman Empire', 'Aztec Empire', 'Mongol Empire']],
  ['What is the study of fungi called?', 'Mycology', ['Phycology', 'Entomology', 'Ornithology']],
  ['Which philosopher wrote The Republic?', 'Plato', ['Aristotle', 'Socrates', 'Epicurus']],
  ['What is the largest internal organ in the human body?', 'Liver', ['Kidney', 'Pancreas', 'Spleen']],
  ['Which programming language was created by Guido van Rossum?', 'Python', ['Ruby', 'Java', 'C#']],
  ['Which city hosted the first modern Olympic Games in 1896?', 'Athens', ['Paris', 'Rome', 'London']],
  ['What is the chemical formula for table salt?', 'NaCl', ['KCl', 'NaOH', 'CaCO3']],
  ['Which ocean trench is the deepest known point in Earth’s oceans?', 'Mariana Trench', ['Tonga Trench', 'Java Trench', 'Puerto Rico Trench']],
  ['Which law states that current equals voltage divided by resistance?', 'Ohm’s law', ['Boyle’s law', 'Hooke’s law', 'Newton’s law']],
  ['Which ancient library was located in Egypt?', 'Library of Alexandria', ['Library of Pergamum', 'Library of Celsus', 'Library of Ashurbanipal']],
  ['What is the name for animals active mainly at dawn and dusk?', 'Crepuscular', ['Nocturnal', 'Diurnal', 'Arboreal']],
  ['Which country was formerly known as Ceylon?', 'Sri Lanka', ['Myanmar', 'Cambodia', 'Laos']],
  ['Which astronomer formulated the laws of planetary motion?', 'Johannes Kepler', ['Nicolaus Copernicus', 'Tycho Brahe', 'Edwin Hubble']],
  ['What is the most abundant element in the universe?', 'Hydrogen', ['Helium', 'Oxygen', 'Carbon']],
  ['Which bone is commonly called the collarbone?', 'Clavicle', ['Scapula', 'Ulna', 'Fibula']],
  ['Which logic gate outputs true only when inputs differ?', 'XOR', ['AND', 'OR', 'NAND']],
  ['Which country contains the ancient city of Petra?', 'Jordan', ['Lebanon', 'Iran', 'Oman']],
  ['Which temperature scale has absolute zero at 0 degrees?', 'Kelvin', ['Celsius', 'Fahrenheit', 'Rankine']],
  ['Who developed the first successful polio vaccine?', 'Jonas Salk', ['Edward Jenner', 'Alexander Fleming', 'Robert Koch']],
  ['Which island is the largest in the Mediterranean Sea?', 'Sicily', ['Crete', 'Cyprus', 'Sardinia']],
  ['What is the term for a word that is spelled the same backward?', 'Palindrome', ['Anagram', 'Homophone', 'Acronym']],
  ['Which metal is liquid at room temperature?', 'Mercury', ['Gallium', 'Lead', 'Zinc']],
  ['Which civilization used a writing system called cuneiform?', 'Sumerians', ['Inca', 'Vikings', 'Olmec']],
  ['Which theorem relates the sides of a right triangle?', 'Pythagorean theorem', ['Binomial theorem', 'Fermat theorem', 'Mean value theorem']],
  ['Which particle has a negative electric charge?', 'Electron', ['Proton', 'Neutron', 'Photon']],
  ['Which country has the most time zones including overseas territories?', 'France', ['Russia', 'United States', 'China']],
  ['Which branch of biology studies insects?', 'Entomology', ['Ichthyology', 'Botany', 'Herpetology']]
];
for (const [prompt, correct, wrong] of hardFacts) hard.push(question(prompt, correct, wrong));

if (easy.length !== 134 || medium.length !== 133 || hard.length !== 133) {
  throw new Error(`Trivia extras count mismatch: easy=${easy.length}, medium=${medium.length}, hard=${hard.length}`);
}

module.exports = { easy, medium, hard };
