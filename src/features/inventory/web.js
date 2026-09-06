const { InventoryRepository } = require('./repositories/inventoryRepository');
const { itemMetadata } = require('./itemCatalog');
const { compareItems } = require('./services/inventoryService');
function inventorySnapshot(db, userId) {
  return { items: new InventoryRepository(db).list(userId).map(item => ({ ...itemMetadata(item.itemKey),
    quantity: item.quantity.toString() })).sort(compareItems) };
}
module.exports = { inventorySnapshot };
