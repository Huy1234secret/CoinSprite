const { LEAF_FROG, MOSSBACK_MONKEY, VINE_SNAKE } = require('./creatures');

const DUNGEON_DIFFICULTY_EMOJI = '<:SBMonstertierI:1451557413525389453>';

const DUNGEONS = {
  1: {
    level: 1,
    stages: {
      1: {
        stage: 1,
        totalFloors: 5,
        danger: 'None',
        requirement: { itemId: 'ITDungeonToken', amount: 1 },
        difficultyEmojis: [DUNGEON_DIFFICULTY_EMOJI],
        floors: [
          [
            { creature: LEAF_FROG, level: 1, count: 3 },
          ],
          [
            { creature: LEAF_FROG, level: 3, count: 2 },
            { creature: MOSSBACK_MONKEY, level: 1, count: 1 },
          ],
          [
            { creature: MOSSBACK_MONKEY, level: 1, count: 3 },
            { creature: LEAF_FROG, level: 5, count: 1 },
          ],
          [
            { creature: VINE_SNAKE, level: 2, count: 2 },
          ],
          [
            { creature: VINE_SNAKE, level: 5, count: 1 },
            { creature: MOSSBACK_MONKEY, level: 3, count: 2 },
          ],
        ],
        rewards: {
          coins: { min: 8000, max: 10000 },
          xp: { min: 350, max: 425 },
          diamonds: { min: 100, max: 100, firstWin: true },
          items: [
            { itemId: 'ITBeastMeat', amount: 20, firstWin: true },
            { itemId: 'ITMossyShavings', amount: 10, firstWin: true },
            { itemId: 'ITVineFiber', amount: 8, firstWin: true },
          ],
        },
      },
    },
  },
};

function getDungeonStage(dungeonLevel, stage) {
  return DUNGEONS[dungeonLevel]?.stages?.[stage] ?? null;
}

module.exports = {
  DUNGEONS,
  DUNGEON_DIFFICULTY_EMOJI,
  getDungeonStage,
};
