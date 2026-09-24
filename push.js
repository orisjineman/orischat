// 웹 푸시(Web Push) 알림 — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 환경 변수가 둘 다
// 있을 때만 동작. Service Worker가 대신 받아주기 때문에 브라우저 탭(심지어 브라우저
// 자체)이 완전히 닫혀 있어도 알림이 옴. 설정 안 하면 이 기능만 조용히 꺼짐.
const webpush = require('web-push');
const subscriptions = require('./lib/pushSubscriptions');

const publicKey = process.env.VAPID_PUBLIC_KEY || '';
const privateKey = process.env.VAPID_PRIVATE_KEY || '';
const subject = process.env.VAPID_SUBJECT || 'mailto:orischat@example.com';

const enabled = Boolean(publicKey && privateKey);

if (enabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.log('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY가 없어서 백그라운드 푸시 알림이 꺼져 있습니다.');
}

async function subscribe({ endpoint, clientId, room, keys }) {
  if (!enabled) return;
  const p256dh = keys && keys.p256dh;
  const auth = keys && keys.auth;
  if (!endpoint || !p256dh || !auth) return;

  await subscriptions.save({ endpoint, clientId, room, p256dh, auth });
}

async function unsubscribe(endpoint) {
  if (!endpoint) return;
  await subscriptions.remove(endpoint);
}

// 메시지 내용은 절대 포함하지 않음 — 잠금화면 등에서 남이 볼 수 있어서, 기존
// 포그라운드 알림(Notification API)과 동일한 정책을 그대로 따름.
function buildPayload(nickname) {
  return JSON.stringify({
    title: `${nickname || '누군가'}님이 메시지를 보냈습니다`,
    body: '확인하려면 클릭하세요',
  });
}

// 구독이 만료/취소된 경우(404 Not Found, 410 Gone)
function isSubscriptionGone(err) {
  return err.statusCode === 404 || err.statusCode === 410;
}

// 한 구독자에게 전송. 만료된 구독은 정리하고, 그 외 오류는 로그만 남김.
async function sendTo(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
  } catch (err) {
    if (isSubscriptionGone(err)) {
      await unsubscribe(sub.endpoint).catch(() => {});
    } else {
      console.error('푸시 전송 오류:', err.message);
    }
  }
}

// 방 안 구독자들에게 푸시 알림 전송 (보낸 사람 본인은 제외).
async function notifyRoom(room, { nickname, excludeClientId }) {
  if (!enabled) return;

  const subs = await subscriptions.forRoom(room);
  const payload = buildPayload(nickname);

  await Promise.all(subs.filter((sub) => sub.clientId !== excludeClientId).map((sub) => sendTo(sub, payload)));
}

module.exports = { enabled, publicKey, subscribe, unsubscribe, notifyRoom };
