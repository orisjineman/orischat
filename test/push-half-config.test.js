// VAPID 키가 둘 중 하나만 있는 설정 실수는 "꺼짐"으로 처리되어야 함.
process.env.VAPID_PUBLIC_KEY = 'only-public';
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.TURSO_DATABASE_URL;

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeWebPush } = require('./helpers/fake-webpush');

const fake = installFakeWebPush();
const push = require('../push');

test('공개키만 있고 비공개키가 없으면 비활성으로 처리된다', async () => {
  assert.equal(push.enabled, false);
  assert.equal(fake.calls.vapid.length, 0);
  await push.subscribe({ endpoint: 'https://push.example/y', clientId: 'c', room: 'r', keys: { p256dh: 'p', auth: 'a' } });
  await push.notifyRoom('r', { nickname: '철수', excludeClientId: 'x' });
  assert.equal(fake.calls.sent.length, 0);
});
