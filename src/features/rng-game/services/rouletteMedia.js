const fs = require('fs/promises');
const path = require('path');
const {
  ROULETTE_IMAGE_DIRECTORY,
  ROULETTE_RESULT_IMAGE_DIRECTORY,
  ROULETTE_STATES,
} = require('../config/roulette');

function resultNumber(game) {
  const number = Number(game?.winningNumber);
  if (!Number.isInteger(number) || number < 0 || number > 36) {
    throw new RangeError('A persisted Roulette result from 0 to 36 is required.');
  }
  return number;
}

function rouletteSpinAssetPath(game) {
  return path.join(ROULETTE_IMAGE_DIRECTORY, `${resultNumber(game)}.gif`);
}

function rouletteResultAssetPath(game) {
  return path.join(ROULETTE_RESULT_IMAGE_DIRECTORY, `${resultNumber(game)}.png`);
}

async function loadRouletteStateImage(game, renderer, onError) {
  let assetPath;
  let extension;
  if (game.state === ROULETTE_STATES.SPINNING) {
    assetPath = rouletteSpinAssetPath(game);
    extension = 'gif';
  } else if (game.state === ROULETTE_STATES.FINISHED) {
    assetPath = rouletteResultAssetPath(game);
    extension = 'png';
  } else {
    return { image: await renderer.render(game), extension: 'png', fallback: false };
  }

  try {
    return { image: await fs.readFile(assetPath), extension, assetPath, fallback: false };
  } catch (cause) {
    const error = new Error(`Roulette asset unavailable: ${assetPath}`, { cause });
    onError?.(error, {
      kind: 'roulette-asset',
      assetPath,
      gameId: game.id,
      revision: game.revision,
      state: game.state,
    });
    return { image: await renderer.render(game), extension: 'png', assetPath, fallback: true };
  }
}

module.exports = {
  loadRouletteStateImage,
  rouletteResultAssetPath,
  rouletteSpinAssetPath,
};
