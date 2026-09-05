const { CATALOG } = require('./catalog');
class AchievementService {
  constructor(repository, resolveEmoji) { this.repository = repository; this.resolveEmoji = resolveEmoji; }
  page(userId, requestedPage = 1) {
    const maxPages = Math.ceil(CATALOG.length / 5);
    const page = Math.max(1, Math.min(maxPages, Math.trunc(Number(requestedPage)) || 1));
    return { ...this.repository.snapshot(userId), items: CATALOG.slice((page - 1) * 5, page * 5), page, maxPages, resolveEmoji: this.resolveEmoji };
  }
}
module.exports = { AchievementService };
