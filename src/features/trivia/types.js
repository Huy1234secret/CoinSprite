const TOPICS = Object.freeze({
  everyday: 'Everyday knowledge', animals: 'Animals', food: 'Food',
  math: 'Maths', science: 'Science', geography: 'Geography',
  history: 'History', sports: 'Sports', technology: 'Technology',
  movies: 'Movies & TV', music: 'Music', video_games: 'Video games',
  cartoons: 'Cartoons', anime: 'Anime',
  advanced_science: 'Advanced science', advanced_math: 'Advanced maths',
  literature: 'Literature & comics', mythology: 'Mythology',
  art_architecture: 'Art & architecture', programming: 'Programming',
  game_lore: 'Gaming lore', anime_lore: 'Anime lore',
});
const easy = Object.freeze(['everyday', 'animals', 'food', 'math', 'science', 'geography']);
const medium = Object.freeze([...easy, 'history', 'sports', 'technology', 'movies',
  'music', 'video_games', 'cartoons', 'anime']);
const hard = Object.freeze([...medium, 'advanced_science', 'advanced_math', 'literature',
  'mythology', 'art_architecture', 'programming', 'game_lore', 'anime_lore']);
const DIFFICULTY_TOPICS = Object.freeze({ easy, medium, hard });

module.exports = { TOPICS, DIFFICULTY_TOPICS };
