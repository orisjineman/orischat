// 고정 메시지 저장소. DB(Turso)가 있으면 db.js에 맡기고, 없으면 메모리에 저장함.
const db = require('../db');

// room -> Map<messageId, pin>
const memoryPins = new Map();

// 최근에 고정한 것부터
async function listPins(room) {
  if (db.enabled) return db.listPins(room);
  return Array.from(memoryPins.get(room)?.values() || []).sort((a, b) => b.pinnedAt - a.pinnedAt);
}

// 'ok' | 'exists' | 'full'
async function addPin(room, pin, maxPins) {
  if (db.enabled) return db.addPin(room, pin, maxPins);
  if (!memoryPins.has(room)) memoryPins.set(room, new Map());
  const pins = memoryPins.get(room);
  if (pins.has(pin.id)) return 'exists';
  if (pins.size >= maxPins) return 'full';
  pins.set(pin.id, pin);
  return 'ok';
}

// 실제로 고정돼 있어서 해제했으면 true
async function removePin(room, messageId) {
  if (db.enabled) return db.removePin(room, messageId);
  return Boolean(memoryPins.get(room)?.delete(messageId));
}

// 수정된 메시지의 고정 미리보기 갱신. 고정된 메시지였으면 true
async function updatePinPreview(room, messageId, preview) {
  if (db.enabled) return db.updatePinPreview(messageId, preview);
  const pin = memoryPins.get(room)?.get(messageId);
  if (!pin) return false;
  pin.preview = preview;
  return true;
}

module.exports = { listPins, addPin, removePin, updatePinPreview };
