// 웹 푸시(Web Push) 알림 — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 환경 변수가 둘 다
// 있을 때만 동작. Service Worker가 대신 받아주기 때문에 브라우저 탭(심지어 브라우저
// 자체)이 완전히 닫혀 있어도 알림이 옴. 설정 안 하면 이 기능만 조용히 꺼짐.
const webpush = require('web-push');
const db = require('./db');

const publicKey = process.env.VAPID_PUBLIC_KEY || '';
const privateKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || 'mailto:orischat@example.com';

const enabled = Boolean(publicKey && privateKey);

if (enabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.log('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY가 없어서 백그라운드 푸시 알림이 꺼져 있습니다.');
}

// DB가 없을 때(TURSO 미설정)만 쓰는 메모리 폴백. endpoint -> { clientId, room, p256dh, auth }
const memorySubscriptions = new Map();

async function subscribe({ endpoint, clientId, room, keys }) {
  if (!enabled) return;
  const p256dh = keys && keys.p256dh;
  const auth = keys && keys.auth;
  if (!endpoint || !p256dh || !auth) return;

  if (db.enabled) {
    await db.saveSubscription({ endpoint, clientId, room, p256dh, auth });
  } else {
    memorySubscriptions.set(endpoint, { clientId, room, p256dh, auth });
  }
}

async function unsubscribe(endpoint) {
  if (!endpoint) return;
  if (db.enabled) {
    await db.removeSubscription(endpoint);
  } else {
    memorySubscriptions.delete(endpoint);
  }
}

async function getSubscriptionsForRoom(room) {
  if (db.enabled) return db.getSubscriptionsForRoom(room);
  return Array.from(memorySubscriptions.entries())
    .filter(([, sub]) => sub.room === room)
    .map(([endpoint, sub]) => ({ endpoint, clientId: sub.clientId, p256dh: sub.p256dh, auth: sub.auth }));
}

// 방 안 구독자들에게 푸시 알림 전송 (보낸 사람 본인은 제외).
// 메시지 내용은 절대 포함하지 않음 — 잠금화면 등에서 남이 볼 수 있어서, 기존
// 포그라운드 알림(Notification API)과 동일한 정책을 그대로 따름.
async function notifyRoom(room, { nickname, excludeClientId }) {
  if (!enabled) return;

  const subs = await getSubscriptionsForRoom(room);
  const payload = JSON.stringify({
    title: `${nickname || '누군가'}님이 메시지를 보냈습니다`,
    body: '확인하려면 클릭하세요',
  });

  await Promise.all(
    subs
      .filter((sub) => sub.clientId !== excludeClientId)
      .map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err) {
          // 구독이 만료/취소된 경우(410 Gone, 404 등)는 정리하고, 그 외 오류만 로그
          if (err.statusCode === 404 || err.statusCode === 410) {
            await unsubscribe(sub.endpoint).catch(() => {});
          } else {
            console.error('푸시 전송 오류:', err.message);
          }
        }
      })
  );
}

module.exports = { enabled, publicKey, subscribe, unsubscribe, notifyRoom };
