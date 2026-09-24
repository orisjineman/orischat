// push.js — VAPID 키가 설정되어 있고 DB는 없는 상태(구독을 메모리에 보관)의 동작.
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
process.env.VAPID_SUBJECT = 'mailto:tester@example.com';
delete process.env.TURSO_DATABASE_URL;

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeWebPush } = require('./helpers/fake-webpush');

const fake = installFakeWebPush();
const push = require('../push');
const { defineScenarios } = require('./helpers/push-scenarios');

test('VAPID 키가 있으면 활성화되고, 공개키를 노출하며, web-push를 초기화한다', () => {
  assert.equal(push.enabled, true);
  assert.equal(push.publicKey, 'test-public-key');
  assert.deepEqual(fake.calls.vapid, [['mailto:tester@example.com', 'test-public-key', 'test-private-key']]);
});

defineScenarios(push, fake);
