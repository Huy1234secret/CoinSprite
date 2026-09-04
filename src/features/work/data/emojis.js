const emoji = (name, id) => Object.freeze({ name, id });

const BURGER_EMOJIS = Object.freeze({
  bottom_bun: emoji('CSBBun', '1545050446526419045'),
  top_bun: emoji('CSTBun', '1545050464100548618'),
  ketchup: emoji('CSKetchup', '1545050454092685342'),
  cucumber: emoji('CSCucumber', '1545050451878092851'),
  cheese: emoji('CSCheese', '1545050449164509264'),
  mayonnaise: emoji('CSMayonnaise', '1545050535680544828'),
  tomato: emoji('CSTomato', '1545050466482782289'),
  onion: emoji('CSOnion', '1545050461386838118'),
  mustard: emoji('CSMustard', '1545050458450559078'),
  lettuce: emoji('CSLettuce', '1545050456319860837'),
  beef_patty: Object.freeze({ name: '🥩' }),
});

const TRASH_EMOJIS = Object.freeze({
  recycle: emoji('CSTRecycle', '1545050549693710436'),
  organic: emoji('CSTOrganic', '1545050547445309491'),
  medical: emoji('CSTMedical', '1545050545239097365'),
  hazardous: emoji('CSTHazardous', '1545050542890422372'),
  glass: emoji('CSTGlass', '1545050540403204188'),
  general: emoji('CSTGeneral', '1545050537924370544'),
});

const PIPE_EMOJIS = Object.freeze({
  valve_ns: emoji('CSVan12', '1545125931998257252'),
  valve_ew: emoji('CSVan', '1545109108175405126'),
  ew: emoji('CSPipe1', '1545109098373062696'),
  ns: emoji('CSPipe12', '1545125909479161937'),
  // The connector keys are canonical directions. Rendering never participates in
  // connectivity checks; games/plumber.js uses connector bitmasks exclusively.
  ne: emoji('CSPipe22', '1545109101409730620'),
  es: emoji('CSPipe21', '1545125911722983435'),
  sw: emoji('CSPipe23', '1545125914109546556'),
  wn: emoji('CSPipe24', '1545125916009828453'),
  wne: emoji('CSPipe4', '1545109105910485073'),
  nes: emoji('CSPipe41', '1545125917851000853'),
  esw: emoji('CSPipe42', '1545125920329834516'),
  swn: emoji('CSPipe43', '1545125921927725087'),
  nesw: emoji('CSPipe3', '1545109103939031201'),
});

const WORK_EMOJIS = Object.freeze({
  bronze: '<:CSBC:1544762628474282064>',
  fire: '<:CSFire:1545308275136794704>',
  level: '<:CSWorklevel:1545313520151691304>',
  token: '<:CSWorkToken:1545303925907918938>',
});

module.exports = { BURGER_EMOJIS, PIPE_EMOJIS, TRASH_EMOJIS, WORK_EMOJIS };
