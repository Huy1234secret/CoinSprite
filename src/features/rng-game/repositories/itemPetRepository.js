const { randomInt } = require('crypto');
const { ITEMS, ITEM_BY_ID } = require('../data/items');
const { PETS, PET_BY_ID, PET_SLOT_PRICES } = require('../data/pets');
const { SQLITE_INTEGER_MAX } = require('./gameRepository');

const RESTOCK_INTERVAL_MS = 30 * 60 * 1_000;
const MAX_HATCH_AMOUNT = 10;
const MAX_WEIGHT_MULTIPLIER_BPS = 17_500;
const MAX_PET_VALUE_BONUS_BPS = 2_000;

function checkedAmount(value, maximum = SQLITE_INTEGER_MAX) {
  let amount;
  try {
    amount = BigInt(value);
  } catch {
    throw new RangeError('Amount must be a positive whole number.');
  }
  if (amount < 1n || amount > BigInt(maximum)) throw new RangeError('Amount is outside the supported range.');
  return amount;
}

function checkedRandomInt(rng, maximum) {
  const result = rng(maximum);
  if (!Number.isSafeInteger(result) || result < 0 || result >= maximum) {
    throw new RangeError(`Injected RNG returned ${result} for [0, ${maximum}).`);
  }
  return result;
}

function currentRestockEpoch(now) {
  return Math.floor(Number(now) / RESTOCK_INTERVAL_MS) * RESTOCK_INTERVAL_MS;
}

function nextRestockAt(now) {
  return (Math.floor(Number(now) / RESTOCK_INTERVAL_MS) + 1) * RESTOCK_INTERVAL_MS;
}

function jsonResult(row) {
  if (!row) return null;
  const value = JSON.parse(row.result_json);
  for (const key of ['amount', 'balance', 'cost', 'price', 'quantity', 'total']) {
    if (value[key] != null) value[key] = BigInt(value[key]);
  }
  return { ...value, duplicate: true };
}

function stringifyResult(result) {
  return JSON.stringify(result, (_, value) => (typeof value === 'bigint' ? String(value) : value));
}

function petInstance(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id,
    petId: row.pet_id,
    pet: PET_BY_ID.get(row.pet_id) || null,
    hatchedAt: Number(row.hatched_at),
  };
}

function multiplyBps(left, right, cap = MAX_WEIGHT_MULTIPLIER_BPS) {
  const combined = Math.floor((Number(left) * Number(right)) / 10_000);
  return Math.max(0, Math.min(cap, combined));
}

class ItemPetRepository {
  constructor(db, gameRepository, options = {}) {
    this.db = db;
    this.gameRepository = gameRepository;
    this.restockRng = options.restockRng || randomInt;
    this.hatchRng = options.hatchRng || randomInt;
    this.statements = {
      operation: db.prepare('SELECT result_json FROM rng_operations WHERE operation_key = ?'),
      saveOperation: db.prepare(`INSERT INTO rng_operations
        (operation_key, user_id, operation_kind, result_json, created_at) VALUES (?, ?, ?, ?, ?)`),
      player: db.prepare('SELECT * FROM rng_players WHERE user_id = ?'),
      updateBalance: db.prepare('UPDATE rng_players SET sheckle_balance = ?, updated_at = ? WHERE user_id = ?'),
      itemQuantity: db.prepare('SELECT quantity FROM rng_player_items WHERE user_id = ? AND item_id = ?'),
      itemInventory: db.prepare('SELECT item_id, quantity, updated_at FROM rng_player_items WHERE user_id = ? AND quantity > 0 ORDER BY item_id'),
      addItem: db.prepare(`INSERT INTO rng_player_items (user_id, item_id, quantity, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET
        quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`),
      consumeItem: db.prepare(`UPDATE rng_player_items SET quantity = quantity - ?, updated_at = ?
        WHERE user_id = ? AND item_id = ? AND quantity >= ?`),
      deleteEmptyItems: db.prepare('DELETE FROM rng_player_items WHERE user_id = ? AND quantity = 0'),
      cleanupEffects: db.prepare('DELETE FROM rng_active_item_effects WHERE ends_at <= ?'),
      effects: db.prepare('SELECT * FROM rng_active_item_effects WHERE user_id = ? AND ends_at > ? ORDER BY item_id'),
      effect: db.prepare('SELECT * FROM rng_active_item_effects WHERE user_id = ? AND item_id = ?'),
      activeSprinkler: db.prepare(`SELECT * FROM rng_active_item_effects
        WHERE user_id = ? AND effect_group = 'sprinkler' AND ends_at > ? LIMIT 1`),
      saveEffect: db.prepare(`INSERT INTO rng_active_item_effects
        (user_id, item_id, effect_group, ends_at, activated_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET
        ends_at = excluded.ends_at, updated_at = excluded.updated_at`),
      addCharges: db.prepare(`INSERT INTO rng_watering_can_charges (user_id, item_id, charges, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET
        charges = charges + excluded.charges, updated_at = excluded.updated_at`),
      charges: db.prepare('SELECT item_id, charges FROM rng_watering_can_charges WHERE user_id = ? AND charges > 0 ORDER BY item_id'),
      consumeCharge: db.prepare(`UPDATE rng_watering_can_charges SET charges = charges - 1, updated_at = ?
        WHERE user_id = ? AND item_id = ? AND charges > 0`),
      deleteEmptyCharges: db.prepare('DELETE FROM rng_watering_can_charges WHERE user_id = ? AND charges = 0'),
      restock: db.prepare('SELECT * FROM rng_shop_restocks WHERE restock_epoch = ?'),
      insertRestock: db.prepare('INSERT OR IGNORE INTO rng_shop_restocks (restock_epoch, created_at) VALUES (?, ?)'),
      insertStock: db.prepare('INSERT INTO rng_shop_stock (restock_epoch, item_id, price, stock) VALUES (?, ?, ?, ?)'),
      stockForEpoch: db.prepare('SELECT * FROM rng_shop_stock WHERE restock_epoch = ? ORDER BY item_id'),
      stockItem: db.prepare('SELECT * FROM rng_shop_stock WHERE restock_epoch = ? AND item_id = ?'),
      decrementStock: db.prepare(`UPDATE rng_shop_stock SET stock = stock - ?
        WHERE restock_epoch = ? AND item_id = ? AND stock >= ?`),
      insertPet: db.prepare('INSERT INTO rng_pet_instances (owner_user_id, pet_id, hatched_at) VALUES (?, ?, ?)'),
      petById: db.prepare('SELECT * FROM rng_pet_instances WHERE id = ?'),
      ownedPets: db.prepare('SELECT * FROM rng_pet_instances WHERE owner_user_id = ? ORDER BY hatched_at, id'),
      ensureSlot: db.prepare(`INSERT OR IGNORE INTO rng_pet_slots
        (user_id, slot_number, unlocked, pet_instance_id, unlocked_at, updated_at)
        VALUES (?, ?, ?, NULL, ?, ?)`),
      slots: db.prepare('SELECT * FROM rng_pet_slots WHERE user_id = ? ORDER BY slot_number'),
      slot: db.prepare('SELECT * FROM rng_pet_slots WHERE user_id = ? AND slot_number = ?'),
      unlockSlot: db.prepare(`UPDATE rng_pet_slots SET unlocked = 1, unlocked_at = ?, updated_at = ?
        WHERE user_id = ? AND slot_number = ? AND unlocked = 0`),
      equippedPets: db.prepare(`SELECT p.*, s.slot_number FROM rng_pet_slots s
        JOIN rng_pet_instances p ON p.id = s.pet_instance_id
        WHERE s.user_id = ? AND s.unlocked = 1 ORDER BY s.slot_number`),
      equippedElsewhere: db.prepare(`SELECT pet_instance_id FROM rng_pet_slots
        WHERE user_id = ? AND slot_number != ? AND pet_instance_id IS NOT NULL`),
      equipSlot: db.prepare(`UPDATE rng_pet_slots SET pet_instance_id = ?, updated_at = ?
        WHERE user_id = ? AND slot_number = ? AND unlocked = 1`),
      unequipSlot: db.prepare(`UPDATE rng_pet_slots SET pet_instance_id = NULL, updated_at = ?
        WHERE user_id = ? AND slot_number = ? AND unlocked = 1`),
    };

    this.restockTransaction = db.transaction((epoch, now, rng) => {
      if (this.statements.restock.get(BigInt(epoch))) return { created: false, epoch };
      if (Number(this.statements.insertRestock.run(BigInt(epoch), BigInt(now)).changes) !== 1) {
        return { created: false, epoch };
      }
      for (const catalogueItem of ITEMS) {
        const inStock = checkedRandomInt(rng, 10_000) < catalogueItem.restockChanceBps;
        const stock = inStock
          ? catalogueItem.stock.minimum + checkedRandomInt(
            rng,
            catalogueItem.stock.maximum - catalogueItem.stock.minimum + 1,
          )
          : 0;
        this.statements.insertStock.run(BigInt(epoch), catalogueItem.id, catalogueItem.price, BigInt(stock));
      }
      return { created: true, epoch };
    }).immediate;

    this.purchaseTransaction = db.transaction((userId, itemId, amount, operationKey, now, epoch) => {
      this.gameRepository.ensurePlayer(userId, now);
      const prior = jsonResult(this.statements.operation.get(operationKey));
      if (prior) return prior;
      const catalogueItem = ITEM_BY_ID.get(itemId);
      if (!catalogueItem) return { status: 'invalid-item', duplicate: false };
      const row = this.statements.stockItem.get(BigInt(epoch), itemId);
      if (!row) return { status: 'stale-restock', duplicate: false };
      if (row.stock < amount) return { status: 'stock', available: row.stock, duplicate: false };
      const total = row.price * amount;
      if (total > SQLITE_INTEGER_MAX) throw new RangeError('Purchase total exceeds the SQLite signed 64-bit range.');
      const player = this.statements.player.get(userId);
      if (player.sheckle_balance < total) {
        return { status: 'insufficient', total, missing: total - player.sheckle_balance, balance: player.sheckle_balance, duplicate: false };
      }
      const existingQuantity = this.statements.itemQuantity.get(userId, itemId)?.quantity || 0n;
      if (existingQuantity + amount > SQLITE_INTEGER_MAX) throw new RangeError('Item quantity exceeds the SQLite signed 64-bit range.');
      if (Number(this.statements.decrementStock.run(amount, BigInt(epoch), itemId, amount).changes) !== 1) {
        return { status: 'stock', available: 0n, duplicate: false };
      }
      const balance = player.sheckle_balance - total;
      this.statements.updateBalance.run(balance, BigInt(now), userId);
      this.statements.addItem.run(userId, itemId, amount, BigInt(now));
      const quantity = existingQuantity + amount;
      const result = {
        status: 'ok', itemId, amount, price: row.price, total, balance, quantity,
        stock: row.stock - amount, restockEpoch: epoch, duplicate: false,
      };
      this.statements.saveOperation.run(operationKey, userId, 'shop-purchase', stringifyResult(result), BigInt(now));
      return result;
    }).immediate;

    this.useTransaction = db.transaction((userId, itemId, amount, operationKey, now) => {
      this.gameRepository.ensurePlayer(userId, now);
      this.ensurePetSlots(userId, now);
      const prior = jsonResult(this.statements.operation.get(operationKey));
      if (prior) return prior;
      const catalogueItem = ITEM_BY_ID.get(itemId);
      if (!catalogueItem) return { status: 'invalid-item', duplicate: false };
      if (catalogueItem.effect.kind === 'egg') return { status: 'egg-required', duplicate: false };
      const owned = this.statements.itemQuantity.get(userId, itemId)?.quantity || 0n;
      if (owned < amount) return { status: 'insufficient-items', owned, duplicate: false };

      this.statements.cleanupEffects.run(BigInt(now));
      let result;
      if (catalogueItem.effect.kind === 'watering-can') {
        const current = this.statements.charges.all(userId)
          .find((entry) => entry.item_id === itemId)?.charges || 0n;
        if (current + amount > SQLITE_INTEGER_MAX) throw new RangeError('Watering-can charges exceed the SQLite signed 64-bit range.');
        this.statements.addCharges.run(userId, itemId, amount, BigInt(now));
        result = { status: 'ok', kind: 'watering-can', itemId, amount, charges: current + amount, duplicate: false };
      } else {
        const effectGroup = catalogueItem.effect.kind === 'sprinkler' ? 'sprinkler' : 'mushroom';
        if (effectGroup === 'sprinkler') {
          const active = this.statements.activeSprinkler.get(userId, BigInt(now));
          if (active && active.item_id !== itemId) {
            return { status: 'sprinkler-conflict', activeItemId: active.item_id, endsAt: Number(active.ends_at), duplicate: false };
          }
        }
        const existing = this.statements.effect.get(userId, itemId);
        const start = existing && existing.ends_at > BigInt(now) ? existing.ends_at : BigInt(now);
        const extension = BigInt(catalogueItem.durationMs) * amount;
        if (start + extension > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new RangeError('Effect duration exceeds the supported timestamp range.');
        }
        const endsAt = start + extension;
        this.statements.saveEffect.run(
          userId, itemId, effectGroup, endsAt,
          existing?.activated_at ?? BigInt(now), BigInt(now),
        );
        result = { status: 'ok', kind: effectGroup, itemId, amount, endsAt: Number(endsAt), duplicate: false };
      }
      if (Number(this.statements.consumeItem.run(amount, BigInt(now), userId, itemId, amount).changes) !== 1) {
        throw new Error('Item inventory changed while activating an effect.');
      }
      this.statements.deleteEmptyItems.run(userId);
      this.statements.saveOperation.run(operationKey, userId, 'item-use', stringifyResult(result), BigInt(now));
      return result;
    }).immediate;

    this.hatchTransaction = db.transaction((userId, itemId, amount, operationKey, now, rng) => {
      this.gameRepository.ensurePlayer(userId, now);
      this.ensurePetSlots(userId, now);
      const prior = jsonResult(this.statements.operation.get(operationKey));
      if (prior) return prior;
      const egg = ITEM_BY_ID.get(itemId);
      if (!egg || egg.effect.kind !== 'egg') return { status: 'invalid-item', duplicate: false };
      if (amount > BigInt(MAX_HATCH_AMOUNT)) return { status: 'too-many-eggs', maximum: MAX_HATCH_AMOUNT, duplicate: false };
      const owned = this.statements.itemQuantity.get(userId, itemId)?.quantity || 0n;
      if (owned < amount) return { status: 'insufficient-items', owned, duplicate: false };
      const results = [];
      for (let index = 0; index < Number(amount); index += 1) {
        let draw = checkedRandomInt(rng, 10_000);
        let selected = PETS.at(-1);
        for (const candidate of PETS) {
          if (draw < candidate.hatchWeight) {
            selected = candidate;
            break;
          }
          draw -= candidate.hatchWeight;
        }
        const inserted = this.statements.insertPet.run(userId, selected.id, BigInt(now));
        results.push(petInstance(this.statements.petById.get(inserted.lastInsertRowid)));
      }
      if (Number(this.statements.consumeItem.run(amount, BigInt(now), userId, itemId, amount).changes) !== 1) {
        throw new Error('Egg inventory changed while hatching pets.');
      }
      this.statements.deleteEmptyItems.run(userId);
      const result = { status: 'ok', kind: 'egg', itemId, amount, pets: results, duplicate: false };
      this.statements.saveOperation.run(operationKey, userId, 'egg-hatch', stringifyResult({
        ...result,
        pets: results.map((entry) => ({ id: entry.id, petId: entry.petId, hatchedAt: entry.hatchedAt })),
      }), BigInt(now));
      return result;
    }).immediate;

    this.unlockTransaction = db.transaction((userId, slotNumber, operationKey, now) => {
      const player = this.gameRepository.ensurePlayer(userId, now);
      this.ensurePetSlots(userId, now);
      const prior = jsonResult(this.statements.operation.get(operationKey));
      if (prior) return prior;
      const cost = PET_SLOT_PRICES[slotNumber];
      if (cost == null || slotNumber === 1) return { status: 'invalid-slot', duplicate: false };
      const slot = this.statements.slot.get(userId, BigInt(slotNumber));
      if (slot.unlocked) return { status: 'already-unlocked', cost: 0n, balance: player.balance, duplicate: false };
      if (player.balance < cost) return { status: 'insufficient', cost, missing: cost - player.balance, balance: player.balance, duplicate: false };
      const balance = player.balance - cost;
      if (Number(this.statements.unlockSlot.run(BigInt(now), BigInt(now), userId, BigInt(slotNumber)).changes) !== 1) {
        return { status: 'already-unlocked', cost: 0n, balance: player.balance, duplicate: false };
      }
      this.statements.updateBalance.run(balance, BigInt(now), userId);
      const result = { status: 'ok', slotNumber, cost, balance, duplicate: false };
      this.statements.saveOperation.run(operationKey, userId, 'pet-slot-unlock', stringifyResult(result), BigInt(now));
      return result;
    }).immediate;

    this.equipTransaction = db.transaction((userId, slotNumber, petId, now) => {
      this.gameRepository.ensurePlayer(userId, now);
      this.ensurePetSlots(userId, now);
      const slot = this.statements.slot.get(userId, BigInt(slotNumber));
      if (!slot || !slot.unlocked) return { status: 'locked-slot' };
      if (petId === 'unequip') {
        this.statements.unequipSlot.run(BigInt(now), userId, BigInt(slotNumber));
        return { status: 'ok', slotNumber, pet: null };
      }
      const pet = PET_BY_ID.get(petId);
      if (!pet) return { status: 'invalid-pet' };
      const unavailable = new Set(this.statements.equippedElsewhere.all(userId, BigInt(slotNumber)).map((row) => String(row.pet_instance_id)));
      const instance = this.statements.ownedPets.all(userId)
        .map(petInstance)
        .find((entry) => entry.petId === petId && !unavailable.has(entry.id));
      if (!instance) return { status: 'unavailable-pet' };
      try {
        if (Number(this.statements.equipSlot.run(BigInt(instance.id), BigInt(now), userId, BigInt(slotNumber)).changes) !== 1) {
          return { status: 'locked-slot' };
        }
      } catch (error) {
        if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) return { status: 'unavailable-pet' };
        throw error;
      }
      return { status: 'ok', slotNumber, pet: instance };
    }).immediate;
  }

  ensurePetSlots(userId, now = Date.now()) {
    const id = String(userId);
    const timestamp = BigInt(now);
    this.gameRepository.ensurePlayer(id, now);
    for (let slot = 1; slot <= 3; slot += 1) {
      const unlocked = slot === 1 ? 1 : 0;
      this.statements.ensureSlot.run(id, BigInt(slot), unlocked, unlocked ? timestamp : null, timestamp);
    }
  }

  ensureRestock(now = Date.now(), rng = this.restockRng) {
    const epoch = currentRestockEpoch(now);
    return this.restockTransaction(epoch, Number(now), rng);
  }

  shopState(now = Date.now(), rng = this.restockRng) {
    const epoch = currentRestockEpoch(now);
    this.ensureRestock(now, rng);
    const rows = new Map(this.statements.stockForEpoch.all(BigInt(epoch)).map((row) => [row.item_id, row]));
    return {
      restockEpoch: epoch,
      nextRestockAt: nextRestockAt(now),
      items: ITEMS.map((catalogueItem) => ({
        ...catalogueItem,
        price: rows.get(catalogueItem.id)?.price ?? catalogueItem.price,
        stockRemaining: rows.get(catalogueItem.id)?.stock ?? 0n,
      })),
    };
  }

  purchase(userId, itemId, amountValue, operationKey, now = Date.now()) {
    const amount = checkedAmount(amountValue);
    this.ensureRestock(now);
    return this.purchaseTransaction(
      String(userId), String(itemId), amount, String(operationKey), Number(now), currentRestockEpoch(now),
    );
  }

  itemInventory(userId, now = Date.now()) {
    const id = String(userId);
    this.gameRepository.ensurePlayer(id, now);
    return this.statements.itemInventory.all(id).map((row) => ({
      itemId: row.item_id,
      item: ITEM_BY_ID.get(row.item_id) || null,
      quantity: row.quantity,
      updatedAt: Number(row.updated_at),
    })).filter((entry) => entry.item);
  }

  use(userId, itemId, amountValue, operationKey, now = Date.now()) {
    const amount = checkedAmount(amountValue);
    const item = ITEM_BY_ID.get(String(itemId));
    if (item?.effect.kind === 'egg') {
      const result = this.hatchTransaction(
        String(userId), String(itemId), amount, String(operationKey), Number(now), this.hatchRng,
      );
      if (result.pets) result.pets = result.pets.map((entry) => ({
        ...entry,
        pet: entry.pet || PET_BY_ID.get(entry.petId) || null,
      }));
      return result;
    }
    return this.useTransaction(String(userId), String(itemId), amount, String(operationKey), Number(now));
  }

  activeEffects(userId, now = Date.now()) {
    this.statements.cleanupEffects.run(BigInt(now));
    return this.statements.effects.all(String(userId), BigInt(now)).map((row) => ({
      itemId: row.item_id,
      item: ITEM_BY_ID.get(row.item_id) || null,
      effectGroup: row.effect_group,
      endsAt: Number(row.ends_at),
    })).filter((entry) => entry.item);
  }

  petState(userId, now = Date.now()) {
    const id = String(userId);
    this.ensurePetSlots(id, now);
    const instances = this.statements.ownedPets.all(id).map(petInstance).filter((entry) => entry.pet);
    const byId = new Map(instances.map((entry) => [entry.id, entry]));
    const slots = this.statements.slots.all(id).map((row) => ({
      slotNumber: Number(row.slot_number),
      unlocked: Boolean(row.unlocked),
      pet: row.pet_instance_id == null ? null : byId.get(String(row.pet_instance_id)) || null,
      price: PET_SLOT_PRICES[Number(row.slot_number)],
    }));
    const collection = PETS.map((pet) => ({
      pet,
      count: instances.filter((entry) => entry.petId === pet.id).length,
    })).filter((entry) => entry.count > 0);
    return { slots, instances, collection };
  }

  availablePetSpecies(userId, slotNumber, now = Date.now()) {
    const state = this.petState(userId, now);
    const slot = state.slots.find((entry) => entry.slotNumber === Number(slotNumber));
    const equippedElsewhere = new Map();
    for (const candidate of state.slots) {
      if (candidate.slotNumber === Number(slotNumber) || !candidate.pet) continue;
      equippedElsewhere.set(candidate.pet.petId, (equippedElsewhere.get(candidate.pet.petId) || 0) + 1);
    }
    const available = state.collection.filter(({ pet, count }) => count > (equippedElsewhere.get(pet.id) || 0));
    return { slot, available };
  }

  unlockSlot(userId, slotNumber, operationKey, now = Date.now()) {
    return this.unlockTransaction(String(userId), Number(slotNumber), String(operationKey), Number(now));
  }

  equipPet(userId, slotNumber, petId, now = Date.now()) {
    return this.equipTransaction(String(userId), Number(slotNumber), String(petId), Number(now));
  }

  resolveRollModifiers(userId, now = Date.now()) {
    const id = String(userId);
    this.ensurePetSlots(id, now);
    const equipped = this.statements.equippedPets.all(id).map((row) => ({
      ...petInstance(row), slotNumber: Number(row.slot_number),
    })).filter((entry) => entry.pet);
    const effects = this.activeEffects(id, now);
    const chargeRows = this.statements.charges.all(id);
    const watering = chargeRows
      .map((row) => ({ row, item: ITEM_BY_ID.get(row.item_id) }))
      .filter((entry) => entry.item?.effect.kind === 'watering-can')
      .sort((left, right) => right.item.effect.weightBps - left.item.effect.weightBps)[0] || null;

    let weightMultiplierBps = 10_000;
    let petValueBonusBps = 0;
    let bigBonusBps = 0;
    const rarityModifiers = [];
    for (const instance of equipped) {
      const effect = instance.pet.effect;
      if (effect.weightBps) weightMultiplierBps = multiplyBps(weightMultiplierBps, effect.weightBps);
      if (effect.valueBonusBps) petValueBonusBps = Math.min(MAX_PET_VALUE_BONUS_BPS, petValueBonusBps + effect.valueBonusBps);
      if (effect.bigBonusBps) bigBonusBps += effect.bigBonusBps;
      if (effect.kind === 'rarity' || effect.kind === 'rarity-group') {
        rarityModifiers.push({ ...effect, phase: 'pet', sourceId: instance.pet.id });
      }
    }
    for (const active of effects) {
      const effect = active.item.effect;
      if (effect.weightBps) weightMultiplierBps = multiplyBps(weightMultiplierBps, effect.weightBps);
      if (effect.bigBonusBps) bigBonusBps += effect.bigBonusBps;
      if (effect.kind === 'rarity') rarityModifiers.push({ ...effect, phase: 'item', sourceId: active.item.id });
    }
    if (watering) weightMultiplierBps = multiplyBps(weightMultiplierBps, watering.item.effect.weightBps);
    return {
      rarityModifiers,
      weightMultiplierBps: Math.min(MAX_WEIGHT_MULTIPLIER_BPS, weightMultiplierBps),
      valueBonusBps: petValueBonusBps,
      bigBonusBps,
      wateringCanItemId: watering?.item.id || null,
      equippedPetInstanceIds: equipped.map((entry) => entry.id),
      activeItemIds: effects.map((entry) => entry.itemId),
    };
  }

  consumeWateringCharge(userId, itemId, now = Date.now()) {
    if (!itemId) return false;
    const changed = Number(this.statements.consumeCharge.run(BigInt(now), String(userId), String(itemId)).changes) === 1;
    if (changed) this.statements.deleteEmptyCharges.run(String(userId));
    return changed;
  }
}

module.exports = {
  ItemPetRepository,
  MAX_HATCH_AMOUNT,
  MAX_PET_VALUE_BONUS_BPS,
  MAX_WEIGHT_MULTIPLIER_BPS,
  RESTOCK_INTERVAL_MS,
  checkedAmount,
  currentRestockEpoch,
  nextRestockAt,
  petInstance,
};
