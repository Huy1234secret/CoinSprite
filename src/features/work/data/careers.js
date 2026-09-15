const DAY_MS = 86_400_000;
const BOOST_GOALS = Object.freeze([5, 10, 16, 23, 31, 40, 50, 61, 73, 86]);
const MIN_CAREER_SALARY = 1_000;
const MAX_CAREER_SALARY = 200_000;
const names = `Leaf Raker|Street Sweeper|Newspaper Deliverer|Bottle Collector|Shoe Shiner|Cart Collector|Grocery Bagger|Dishwasher|Laundry Attendant|Car Washer|Dog Walker|Pet Sitter|Babysitter|House Cleaner|Hotel Housekeeper|Janitor|Farmhand|Fruit Picker|Gardener|Groundskeeper|Fast Food Crew Member|Cashier|Shelf Stocker|Warehouse Packer|Delivery Courier|Pizza Delivery Driver|Barista|Server|Bartender|Line Cook|Baker|Butcher|Fishmonger|Florist|Tailor|Barber|Hairstylist|Makeup Artist|Receptionist|Customer Support Agent|Office Assistant|Data Entry Clerk|Security Guard|Lifeguard|Tour Guide|Fitness Trainer|Photographer|Graphic Designer|Video Editor|Social Media Manager|Translator|Tutor|Librarian|Teacher|Chef|Restaurant Manager|Hotel Manager|Event Planner|Mechanic|Carpenter|Plumber|Electrician|Welder|HVAC Technician|Truck Driver|Train Operator|Crane Operator|Firefighter|Paramedic|Police Officer|Detective|Nurse|Dental Hygienist|Accountant|Financial Analyst|Real Estate Agent|Architect|Civil Engineer|Mechanical Engineer|Electrical Engineer|Software Developer|Cybersecurity Analyst|Data Scientist|AI Engineer|Aerospace Engineer|Airline Pilot|Ship Captain|Lawyer|Veterinarian|Pharmacist|Dentist|Physician|Surgeon|Neurosurgeon|Astronaut|Investment Banker|Hedge Fund Manager|Film Star|Professional Athlete|Chief Executive Officer`.split('|');
function careerSalary(level) {
  return Math.round(MIN_CAREER_SALARY
    + (MAX_CAREER_SALARY - MIN_CAREER_SALARY) * (level - 1) / (names.length - 1));
}
const CAREERS = Object.freeze(names.map((name, i) => {
  const level = i + 1;
  return Object.freeze({ id: level, level, name, salary: careerSalary(level),
    totalRequired: Math.ceil(10 + 5 * level ** 1.5), dailyRequired: level >= 90 ? 12 : 3 + Math.floor(i / 10) });
}));
module.exports = { CAREERS, DAY_MS, BOOST_GOALS, MAX_CAREER_SALARY, MIN_CAREER_SALARY, careerSalary };
