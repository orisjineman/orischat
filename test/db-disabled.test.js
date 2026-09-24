// TURSO_DATABASE_URL이 없을 때(로컬 개발 등) db.js의 모든 함수가 에러 없이 "아무것도 안 함"
// 값을 돌려주는지 확인함. 서버가 DB 유무와 상관없이 같은 코드로 돌 수 있게 하는 계약.
delete process.env.TURSO_DATABASE_URL;

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');

test('비활성 상태다', () => {
  assert.equal(db.enabled, false);
});

test('init은 아무것도 하지 않고 끝난다', async () => {
  await db.init();
});

test('조회 계열은 빈 값을 돌려준다', async () => {
  assert.deepEqual(await db.getRecentMessages('room', 50), []);
  assert.deepEqual(await db.getMessagesBefore('room', Date.now(), 50), []);
  assert.deepEqual(await db.searchMessages('room', 'q', 50), []);
  assert.deepEqual(await db.getKnownRooms(50), []);
  assert.deepEqual(await db.getSubscriptionsForRoom('room'), []);
  assert.equal(await db.getAvatar('nick'), null);
});

test('쓰기 계열은 조용히 무시되고, 결과 값은 "실패/없음"이다', async () => {
  await db.insertMessage({ id: 'x', type: 'text', content: 'c', nickname: 'n', clientId: 'c', room: 'r', time: 1 });
  assert.equal(await db.editMessage('x', 'c', '새'), false);
  assert.deepEqual(await db.toggleReaction('x', '👍', 'c'), {});
  assert.equal(await db.deleteMessage('x', 'c'), null);
  await db.cleanupOldMessages();
  await db.saveSubscription({ endpoint: 'e', clientId: 'c', room: 'r', p256dh: 'p', auth: 'a' });
  await db.removeSubscription('e');
  await db.setAvatar('nick', 'data:image/png;base64,AAAA');
  assert.equal(await db.getAvatar('nick'), null);
});
