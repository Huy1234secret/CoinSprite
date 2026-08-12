const WORK_RANKS = Object.freeze([
  { level: 1, name: 'Rookie', threshold: 0, salaryBoost: 0 },
  { level: 2, name: 'Novice', threshold: 100, salaryBoost: 2 },
  { level: 3, name: 'Beginner', threshold: 250, salaryBoost: 4 },
  { level: 4, name: 'Apprentice', threshold: 500, salaryBoost: 6 },
  { level: 5, name: 'Initiate', threshold: 900, salaryBoost: 8 },
  { level: 6, name: 'Adept', threshold: 1_500, salaryBoost: 10 },
  { level: 7, name: 'Capable', threshold: 2_400, salaryBoost: 13 },
  { level: 8, name: 'Skilled', threshold: 3_600, salaryBoost: 16 },
  { level: 9, name: 'Proficient', threshold: 5_200, salaryBoost: 20 },
  { level: 10, name: 'Experienced', threshold: 7_200, salaryBoost: 25 },
  { level: 11, name: 'Advanced', threshold: 9_700, salaryBoost: 30 },
  { level: 12, name: 'Specialist', threshold: 12_800, salaryBoost: 36 },
  { level: 13, name: 'Expert', threshold: 16_500, salaryBoost: 42 },
  { level: 14, name: 'Veteran', threshold: 21_000, salaryBoost: 50 },
  { level: 15, name: 'Elite', threshold: 26_500, salaryBoost: 60 },
  { level: 16, name: 'Master', threshold: 33_000, salaryBoost: 72 },
  { level: 17, name: 'Grandmaster', threshold: 41_000, salaryBoost: 85 },
  { level: 18, name: 'Legendary', threshold: 51_000, salaryBoost: 100 },
  { level: 19, name: 'Mythic', threshold: 63_500, salaryBoost: 120 },
  { level: 20, name: 'Ascendant', threshold: 80_000, salaryBoost: 150 },
].map(Object.freeze));

function workRank(totalXp) {
  const xp = BigInt(totalXp ?? 0);
  let current = WORK_RANKS[0];
  for (const rank of WORK_RANKS) {
    if (xp < BigInt(rank.threshold)) break;
    current = rank;
  }
  return current;
}

function workProgress(totalXp) {
  const xp = BigInt(totalXp ?? 0);
  const rank = workRank(xp);
  const nextRank = WORK_RANKS[rank.level] || null;
  if (!nextRank) {
    return { rank, nextRank: null, currentRankXp: xp - BigInt(rank.threshold), requiredXp: 0n, percent: 100 };
  }
  const currentRankXp = xp - BigInt(rank.threshold);
  const requiredXp = BigInt(nextRank.threshold - rank.threshold);
  const percent = Number((currentRankXp * 100n) / requiredXp);
  return {
    rank,
    nextRank,
    currentRankXp,
    requiredXp,
    percent: Math.max(0, Math.min(100, percent)),
  };
}

function progressBar(percent) {
  const value = Math.max(0, Math.min(100, Math.floor(Number(percent) || 0)));
  const filled = Math.floor(value / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

function boostedReward(baseReward, salaryBoost) {
  const base = BigInt(baseReward);
  return (base * BigInt(100 + Number(salaryBoost)) + 50n) / 100n;
}

function unlockedDifficulties(level) {
  if (Number(level) >= 13) return Object.freeze(['easy', 'medium', 'hard']);
  if (Number(level) >= 6) return Object.freeze(['easy', 'medium']);
  return Object.freeze(['easy']);
}

module.exports = {
  WORK_RANKS,
  boostedReward,
  progressBar,
  unlockedDifficulties,
  workProgress,
  workRank,
};
