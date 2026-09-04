class InventoryRepository {
  constructor(db) {
    this.db = db;
    this.listStatement = db.prepare(`SELECT item_key, quantity FROM inventory
      WHERE user_id = ? AND quantity > 0`);
  }

  list(userId) {
    return this.listStatement.all(String(userId)).map((row) => ({
      itemKey: String(row.item_key),
      quantity: BigInt(row.quantity),
    }));
  }
}

module.exports = { InventoryRepository };
