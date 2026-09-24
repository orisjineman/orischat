// push.js — VAPID 키 + DB(로컬 libSQL 파일)가 켜진 상태(구독을 DB에 보관)의 동작.
// 메모리 모드(push.test.js)와 똑같은 시나리오가 통과해야 함.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orischat-pushdb-'));
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, 'push.db')}`;
process.env.VAPID_PUBLIC_KEY = 'test-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
delete process.env.VAPID_SUBJECT;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeWebPush } = require('./helpers/fake-webpush');

const fake = installFakeWebPush();
const db = require('../db');
const push = require('../push');
const { defineScenarios } = require('./helpers/push-scenarios');

before(async () => {
  await db.init();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('DB 모드: 기본 subject로 초기화되고, 구독이 실제로 DB에 저장/삭제된다', async () => {
  assert.equal(db.enabled, true);
  assert.equal(push.enabled, true);
  assert.deepEqual(fake.calls.vapid, [['mailto:orischat@example.com', 'test-public-key', 'test-private-key']]);

  await push.subscribe({ endpoint: 'https://push.example/db-check', clientId: 'c', room: 'db-check-room', keys: { p256dh: 'p', auth: 'a' } });
  assert.deepEqual((await db.getSubscriptionsForRoom('db-check-room')).map((s) => s.endpoint), ['https://push.example/db-check']);

  await push.unsubscribe('https://push.example/db-check');
  assert.deepEqual(await db.getSubscriptionsForRoom('db-check-room'), []);
});

defineScenarios(push, fake);
