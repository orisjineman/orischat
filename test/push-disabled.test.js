// push.js — VAPID 키가 없으면 기능 전체가 조용히 꺼져야 함 (구독도 알림도 no-op).
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.TURSO_DATABASE_URL;

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeWebPush } = require('./helpers/fake-webpush');

const fake = installFakeWebPush();
const push = require('../push');

test('비활성 상태이고 web-push를 초기화하지 않는다', () => {
  assert.equal(push.enabled, false);
  assert.equal(push.publicKey, '');
  assert.equal(fake.calls.vapid.length, 0);
});

test('구독/해제/알림을 호출해도 에러 없이 아무것도 보내지 않는다', async () => {
  await push.subscribe({ endpoint: 'https://push.example/x', clientId: 'c', room: 'r', keys: { p256dh: 'p', auth: 'a' } });
  await push.notifyRoom('r', { nickname: '철수', excludeClientId: 'x' });
  await push.unsubscribe('https://push.example/x');
  assert.equal(fake.calls.sent.length, 0);
});
