// 웹 푸시 구독 저장소. DB(Turso)가 켜져 있으면 DB에, 없으면(로컬 개발 등) 메모리에 보관함.
// 호출하는 쪽은 어느 쪽인지 신경 쓰지 않아도 됨.
//   save({ endpoint, clientId, room, p256dh, auth })
//   remove(endpoint)
//   forRoom(room) → [{ endpoint, clientId, p256dh, auth }]
const db = require('../db');

// endpoint -> { clientId, room, p256dh, auth }
const memorySubscriptions = new Map();

const memoryStore = {
  async save({ endpoint, clientId, room, p256dh, auth }) {
    memorySubscriptions.set(endpoint, { clientId, room, p256dh, auth });
  },
  async remove(endpoint) {
    memorySubscriptions.delete(endpoint);
  },
  async forRoom(room) {
    return Array.from(memorySubscriptions.entries())
      .filter(([, sub]) => sub.room === room)
      .map(([endpoint, sub]) => ({ endpoint, clientId: sub.clientId, p256dh: sub.p256dh, auth: sub.auth }));
  },
};

const dbStore = {
  save: db.saveSubscription,
  remove: db.removeSubscription,
  forRoom: db.getSubscriptionsForRoom,
};

module.exports = db.enabled ? dbStore : memoryStore;
