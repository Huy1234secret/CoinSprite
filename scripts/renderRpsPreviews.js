const fs = require('fs');
const path = require('path');
const { RPS_STATES } = require('../src/features/rng-game/config/rps');
const { RpsTableRenderer } = require('../src/features/rng-game/services/rpsRenderer');

function previewGame(participantCount, revealed) {
  const moves = ['rock', 'scissors', 'paper', 'scissors'];
  return {
    id: `debug-${participantCount}-${revealed ? 'revealed' : 'hidden'}`,
    mode: 'human',
    state: revealed ? RPS_STATES.FINISHED : RPS_STATES.READY_TO_REVEAL,
    bet: 100n,
    currentTurn: participantCount,
    resultType: revealed ? 'winner' : null,
    winnerUserId: revealed ? 'debug-1' : null,
    participants: Array.from({ length: participantCount }, (_, index) => ({
      userId: `debug-${index + 1}`,
      seat: index,
      displayName: `Player ${index + 1}`,
      avatarUrl: '',
      choice: moves[index],
      accepted: true,
      resultStatus: revealed ? (index === 0 ? 'WIN' : 'LOSE') : null,
    })),
  };
}

async function main() {
  const outputDirectory = path.resolve(process.argv[2] || path.join('work', 'rps-previews'));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const renderer = new RpsTableRenderer();
  for (const participantCount of [2, 3, 4]) {
    const hidden = await renderer.render(previewGame(participantCount, false), {
      guides: true,
      hideAllHands: true,
    });
    const revealed = await renderer.render(previewGame(participantCount, true));
    fs.writeFileSync(path.join(outputDirectory, `rps-${participantCount}-hidden-guides.png`), hidden);
    fs.writeFileSync(path.join(outputDirectory, `rps-${participantCount}-revealed.png`), revealed);
  }
  renderer.clear();
  console.log(`RPS previews written to ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
