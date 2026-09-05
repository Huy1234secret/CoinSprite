// Bonuses are integer ten-thousandths above 1, never floating point multipliers.
const SCALE = 10000n;
const MEDALS = Object.freeze({ bronze: 'CSBMedal', silver: 'CSSMedal', golden: 'CSGMedal', diamond: 'CSDMedal' });
const ROMAN = ['I', 'II', 'III', 'IV'];
const medals = Object.keys(MEDALS);
function track(id, name, metric, thresholds, perks, bonuses, slots = medals) {
  return { id, name, metric, tiers: thresholds.map((target, i) => ({
    target, medal: slots[i], roman: ROMAN[i], perk: perks[i], bonuses: bonuses[i] || {},
  })) };
}
const CATALOG = [
  track('career_worker', 'Career Worker', 'work', [10, 50, 250, 1000],
    ['×1.01 earnings from Work', '×1.075 earnings from Work', '×1.2 earnings from Work; ×1.01 Work XP', '×1.5 earnings from Work; ×1.05 Work XP'],
    [{ work: 100 }, { work: 750 }, { work: 2000, xp: 100 }, { work: 5000, xp: 500 }]),
  track('reliable_employee', 'Reliable Employee', 'streak', [5, 20, 50, 100],
    ['Each streak point adds +0.01 to Work earnings multiplier', 'Each streak point adds +0.02 to Work earnings multiplier', 'Each streak point adds +0.03 to Work earnings multiplier', 'Each streak point adds +0.04 to Work earnings multiplier'],
    [{ streak: 100 }, { streak: 200 }, { streak: 300 }, { streak: 400 }]),
  track('career_advancement', 'Career Advancement', 'level', [5, 15, 30],
    ['Unlock Medium jobs', 'Unlock Hard jobs', 'Unlock Expert jobs'], [], medals.slice(0, 3)),
  track('expert_specialist', 'Expert Specialist', 'expert', [10, 25, 50, 100],
    ['×1.0625 Expert-job earnings', '×1.125 Expert-job earnings', '×1.25 Expert-job earnings', '×1.5 Expert-job earnings'],
    [{ expert: 625 }, { expert: 1250 }, { expert: 2500 }, { expert: 5000 }]),
  track('every_number_counts', 'Every Number Counts', 'counts', [25, 100, 300, 1000],
    ['×1.1 Counting earnings', '×1.2 Counting earnings', '×1.3 Counting earnings', '×1.5 Counting earnings'],
    [{ counting: 1000 }, { counting: 2000 }, { counting: 3000 }, { counting: 5000 }]),
  track('jackpot', 'JACKPOT', 'jackpot', [1], ['×1.777 Counting earnings'], [{ counting: 7770 }], ['diamond']),
  track('67', '67', 'sixty_seven', [1], ['×1.067 Counting earnings'], [{ counting: 670 }], ['bronze']),
];
function perks(earned) {
  const result = { work: 0n, expert: 0n, xp: 0n, counting: 0n, streak: 0n };
  for (const item of CATALOG) {
    const active = item.tiers[(earned[item.id] || 0) - 1];
    for (const [key, value] of Object.entries(active?.bonuses || {})) result[key] += BigInt(value);
  }
  return result;
}
function reward(base, bonus) { return BigInt(base) * (SCALE + BigInt(bonus)) / SCALE; }
function requirement(item, current, target) {
  const progress = `\`${current} / ${target}\``;
  switch (item.metric) {
    case 'work': return `Complete ${progress} jobs`;
    case 'expert': return `Complete ${progress} Expert jobs`;
    case 'streak': return `Complete ${progress} jobs without failing`;
    case 'level': return `Reach Work level ${progress}`;
    case 'counts': return `Submit ${progress} valid counts`;
    default: return `Submit the valid count **${item.id === 'jackpot' ? '777' : '67'}** — ${progress}`;
  }
}
module.exports = { CATALOG, MEDALS, ROMAN, SCALE, perks, reward, requirement };
