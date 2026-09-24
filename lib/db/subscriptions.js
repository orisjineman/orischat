// 웹 푸시 구독 저장 (백그라운드 알림용)
const { query, run, whenEnabled } = require('./client');

const saveSubscription = whenEnabled(
  () => undefined,
  ({ endpoint, clientId, room, p256dh, auth }) =>
    run(
      `INSERT INTO push_subscriptions (endpoint, client_id, room, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET client_id = excluded.client_id, room = excluded.room,
         p256dh = excluded.p256dh, auth = excluded.auth, created_at = excluded.created_at`,
      [endpoint, clientId, room, p256dh, auth, Date.now()]
    )
);

const removeSubscription = whenEnabled(
  () => undefined,
  (endpoint) => run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint])
);

const getSubscriptionsForRoom = whenEnabled(
  () => [],
  (room) => query('SELECT endpoint, client_id as clientId, p256dh, auth FROM push_subscriptions WHERE room = ?', [room])
);

module.exports = { saveSubscription, removeSubscription, getSubscriptionsForRoom };
