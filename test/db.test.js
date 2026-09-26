// db.js를 서버 없이 직접 호출해서 확인하는 테스트 (Turso 대신 로컬 libSQL 파일 사용).
// DB 연결은 모듈을 불러오는 시점에 정해지므로 환경 변수를 먼저 설정함.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orischat-dbunit-'));
const dbFile = path.join(tmpDir, 'unit.db');
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');

let db;

before(async () => {
  // 옛 버전 서버가 만들어둔 DB(room/reply_to/edited_at 컬럼이 없음)를 흉내냄
  const legacy = createClient({ url: process.env.TURSO_DATABASE_URL });
  await legacy.execute(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, content TEXT NOT NULL,
    nickname TEXT NOT NULL, client_id TEXT NOT NULL, time INTEGER NOT NULL
  )`);
  await legacy.execute({
    sql: 'INSERT INTO messages (id, type, content, nickname, client_id, time) VALUES (?, ?, ?, ?, ?, ?)',
    args: ['legacy-1', 'text', '옛날 메시지', 'old', 'old-id', Date.now() - 1000],
  });
  legacy.close();

  db = require('../db');
  await db.init();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const msg = (over = {}) => ({
  id: `m-${++seq}`,
  type: 'text',
  content: `내용 ${seq}`,
  nickname: 'nick',
  clientId: 'client-1',
  room: 'general',
  time: Date.now(),
  ...over,
});

// ---------------------------------------------------------------- 초기화 / 마이그레이션

test('활성화 상태이고, init을 여러 번 불러도 안전하다', async () => {
  assert.equal(db.enabled, true);
  await db.init();
  await db.init();
});

test('옛 스키마의 DB에는 room/reply_to/edited_at 컬럼이 보강되고, 옛 메시지는 general 방으로 남는다', async () => {
  const history = await db.getRecentMessages('general', 100);
  const legacy = history.find((m) => m.id === 'legacy-1');
  assert.ok(legacy, '옛 메시지가 유지되어야 함');
  assert.equal(legacy.content, '옛날 메시지');
  assert.equal(legacy.replyTo, null);
  assert.equal(legacy.edited, false);

  // 새 컬럼을 실제로 쓸 수 있어야 함
  const reply = msg({ room: 'mig', replyTo: { id: 'legacy-1', nickname: 'old', preview: '옛날' } });
  await db.insertMessage(reply);
  const [saved] = await db.getRecentMessages('mig', 10);
  assert.deepEqual(saved.replyTo, reply.replyTo);
});

// ---------------------------------------------------------------- 메시지 저장 / 조회

test('insertMessage → getRecentMessages: 시간순(오래된 것부터)이고 limit만큼 최근 것만 돌려준다', async () => {
  const room = 'recent';
  const base = Date.now() - 10_000;
  for (let i = 0; i < 7; i++) await db.insertMessage(msg({ room, content: `c${i}`, time: base + i }));

  const all = await db.getRecentMessages(room, 50);
  assert.deepEqual(all.map((m) => m.content), ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']);

  const last3 = await db.getRecentMessages(room, 3);
  assert.deepEqual(last3.map((m) => m.content), ['c4', 'c5', 'c6']);

  assert.deepEqual(await db.getRecentMessages('빈방', 50), []);
});

test('메시지 필드: 작성자 clientId, 수정 여부, 빈 리액션이 함께 온다', async () => {
  const m = msg({ room: 'fields', nickname: '철수', clientId: 'chulsoo', content: '본문' });
  await db.insertMessage(m);
  const [saved] = await db.getRecentMessages('fields', 10);
  assert.equal(saved.id, m.id);
  assert.equal(saved.type, 'text');
  assert.equal(saved.content, '본문');
  assert.equal(saved.nickname, '철수');
  assert.equal(saved.clientId, 'chulsoo');
  assert.equal(saved.time, m.time);
  assert.equal(saved.replyTo, null);
  assert.equal(saved.edited, false);
  assert.deepEqual(saved.reactions, {});
  assert.equal('editedAt' in saved, true);
});

test('같은 id로 두 번 저장하면 거절된다', async () => {
  const m = msg({ room: 'dup' });
  await db.insertMessage(m);
  await assert.rejects(db.insertMessage(m));
});

test('reply_to가 깨진 JSON이면 null로 처리된다', async () => {
  const m = msg({ room: 'badreply' });
  await db.insertMessage(m);
  // 직접 망가뜨림
  const client = createClient({ url: process.env.TURSO_DATABASE_URL });
  await client.execute({ sql: "UPDATE messages SET reply_to = '{망가짐' WHERE id = ?", args: [m.id] });
  client.close();
  const [saved] = await db.getRecentMessages('badreply', 10);
  assert.equal(saved.replyTo, null);
});

test('getMessagesBefore: 기준 시각보다 "엄격히" 이전 것만, 시간순으로, limit개', async () => {
  const room = 'before';
  const base = Date.now() - 20_000;
  for (let i = 0; i < 10; i++) await db.insertMessage(msg({ room, content: `b${i}`, time: base + i }));

  const page = await db.getMessagesBefore(room, base + 5, 3);
  assert.deepEqual(page.map((m) => m.content), ['b2', 'b3', 'b4']); // b5 자신은 제외
  assert.deepEqual((await db.getMessagesBefore(room, base, 10)), []); // 가장 오래된 것보다 이전은 없음
  assert.equal((await db.getMessagesBefore(room, base + 100, 50)).length, 10);
  assert.deepEqual(await db.getMessagesBefore('빈방', Date.now(), 10), []);
});

// ---------------------------------------------------------------- 리액션

test('toggleReaction: 추가/취소를 오가며 { 이모지: [clientId...] } 요약을 돌려준다', async () => {
  const m = msg({ room: 'react' });
  await db.insertMessage(m);

  assert.deepEqual(await db.toggleReaction(m.id, '👍', 'a'), { '👍': ['a'] });
  assert.deepEqual(await db.toggleReaction(m.id, '👍', 'b'), { '👍': ['a', 'b'] });
  const mixed = await db.toggleReaction(m.id, '❤️', 'a');
  assert.deepEqual(Object.keys(mixed).sort(), ['❤️', '👍']);
  assert.deepEqual(mixed['👍'].sort(), ['a', 'b']);

  // 같은 사람이 다시 누르면 취소
  assert.deepEqual(await db.toggleReaction(m.id, '👍', 'a'), { '👍': ['b'], '❤️': ['a'] });
  assert.deepEqual(await db.toggleReaction(m.id, '👍', 'b'), { '❤️': ['a'] });
  assert.deepEqual(await db.toggleReaction(m.id, '❤️', 'a'), {});
});

test('리액션은 메시지 조회(getRecentMessages/getMessagesBefore)에 이모지별 clientId 목록으로 붙는다', async () => {
  const room = 'react-attach';
  const base = Date.now() - 5000;
  const first = msg({ room, time: base });
  const second = msg({ room, time: base + 1 });
  await db.insertMessage(first);
  await db.insertMessage(second);
  await db.toggleReaction(first.id, '👍', 'a');
  await db.toggleReaction(first.id, '👍', 'b');
  await db.toggleReaction(second.id, '😂', 'c');

  const recent = await db.getRecentMessages(room, 10);
  assert.deepEqual(recent[0].reactions['👍'].sort(), ['a', 'b']);
  assert.deepEqual(recent[1].reactions, { '😂': ['c'] });

  const before = await db.getMessagesBefore(room, base + 1, 10);
  assert.deepEqual(before[0].reactions['👍'].sort(), ['a', 'b']);
});

// ---------------------------------------------------------------- 수정

test('editMessage: 작성자의 텍스트 메시지만 고칠 수 있고, 수정 시각을 돌려준다', async () => {
  const m = msg({ room: 'edit', clientId: 'author' });
  await db.insertMessage(m);

  const before = Date.now();
  const editedAt = await db.editMessage(m.id, 'author', '새 내용');
  assert.ok(editedAt >= before && editedAt <= Date.now());

  const [saved] = await db.getRecentMessages('edit', 10);
  assert.equal(saved.content, '새 내용');
  assert.equal(saved.edited, true);
  assert.equal(saved.editedAt, editedAt);
});

test('editMessage: 남의 메시지/스티커/사진/없는 메시지는 false이고 내용이 바뀌지 않는다', async () => {
  const text = msg({ room: 'edit-deny', clientId: 'author' });
  const sticker = msg({ room: 'edit-deny', clientId: 'author', type: 'sticker', content: 'a.png' });
  const image = msg({ room: 'edit-deny', clientId: 'author', type: 'image', content: 'data:image/png;base64,AAAA' });
  await Promise.all([text, sticker, image].map((m) => db.insertMessage(m)));

  assert.equal(await db.editMessage(text.id, 'someone-else', '해킹'), false);
  assert.equal(await db.editMessage(sticker.id, 'author', '텍스트로'), false);
  assert.equal(await db.editMessage(image.id, 'author', '텍스트로'), false);
  assert.equal(await db.editMessage('없는-id', 'author', '내용'), false);

  const saved = await db.getRecentMessages('edit-deny', 10);
  assert.deepEqual(saved.map((m) => m.content).sort(), [sticker.content, image.content, text.content].sort());
  assert.ok(saved.every((m) => m.edited === false));
});

// ---------------------------------------------------------------- 삭제

test('deleteMessage: 작성자만 지울 수 있고, 지운 방 이름을 돌려주며 리액션도 함께 지운다', async () => {
  const m = msg({ room: 'del-room', clientId: 'author' });
  await db.insertMessage(m);
  await db.toggleReaction(m.id, '👍', 'x');

  assert.equal(await db.deleteMessage(m.id, 'intruder'), null);
  assert.equal((await db.getRecentMessages('del-room', 10)).length, 1);

  assert.equal(await db.deleteMessage(m.id, 'author'), 'del-room');
  assert.deepEqual(await db.getRecentMessages('del-room', 10), []);
  // 리액션도 사라졌는지: 다시 누르면 "추가"가 되어 한 명만 있어야 함
  assert.deepEqual(await db.toggleReaction(m.id, '👍', 'x'), { '👍': ['x'] });
  await db.toggleReaction(m.id, '👍', 'x'); // 정리

  assert.equal(await db.deleteMessage(m.id, 'author'), null, '이미 지워진 메시지');
  assert.equal(await db.deleteMessage('없는-id', 'author'), null);
});

// ---------------------------------------------------------------- 검색

test('searchMessages: 같은 방 텍스트 메시지를 최신순으로, 대소문자 무시하고 limit까지', async () => {
  const room = 'search';
  const base = Date.now() - 10_000;
  await db.insertMessage(msg({ room, content: 'Apple pie', time: base }));
  await db.insertMessage(msg({ room, content: '바나나', time: base + 1 }));
  await db.insertMessage(msg({ room, content: 'apple tart', time: base + 2 }));
  await db.insertMessage(msg({ room: 'search-other', content: 'apple elsewhere', time: base + 3 }));
  await db.insertMessage(msg({ room, type: 'sticker', content: 'apple.png', time: base + 4 }));

  const found = await db.searchMessages(room, 'APPLE');
  assert.deepEqual(found.map((m) => m.content), ['apple tart', 'Apple pie']);
  assert.ok(found.every((m) => typeof m.clientId === 'string' && typeof m.nickname === 'string'));

  assert.equal((await db.searchMessages(room, 'apple', 1)).length, 1);
  assert.deepEqual(await db.searchMessages(room, '없는말'), []);
});

test('searchMessages: %, _, \\ 는 와일드카드가 아니라 글자 그대로 검색된다', async () => {
  const room = 'search-special';
  const base = Date.now() - 5000;
  await db.insertMessage(msg({ room, content: '할인 100% 진행', time: base }));
  await db.insertMessage(msg({ room, content: 'a_b', time: base + 1 }));
  await db.insertMessage(msg({ room, content: 'axb', time: base + 2 }));
  await db.insertMessage(msg({ room, content: '경로 C:\\temp', time: base + 3 }));

  assert.deepEqual((await db.searchMessages(room, '%')).map((m) => m.content), ['할인 100% 진행']);
  assert.deepEqual((await db.searchMessages(room, 'a_b')).map((m) => m.content), ['a_b']);
  assert.deepEqual((await db.searchMessages(room, '\\')).map((m) => m.content), ['경로 C:\\temp']);
});

// ---------------------------------------------------------------- 방 목록

test('getKnownRooms: 방별 메시지 수와 마지막 활동 시각을 최근 활동순으로 돌려준다', async () => {
  const now = Date.now();
  await db.insertMessage(msg({ room: 'kr-old', time: now - 5 * DAY }));
  await db.insertMessage(msg({ room: 'kr-new', time: now - 2000 }));
  await db.insertMessage(msg({ room: 'kr-new', time: now - 1000 }));

  const rooms = await db.getKnownRooms(1000);
  const names = rooms.map((r) => r.room);
  assert.ok(names.indexOf('kr-new') < names.indexOf('kr-old'));

  const krNew = rooms.find((r) => r.room === 'kr-new');
  assert.equal(Number(krNew.messageCount), 2);
  assert.equal(krNew.lastActivity, now - 1000);

  assert.equal((await db.getKnownRooms(2)).length, 2);
});

// ---------------------------------------------------------------- 오래된 메시지 정리

test('cleanupOldMessages: 7일 넘은 메시지와 그 리액션만 지우고, 7일 이내/정리할 게 없을 때는 그대로 둔다', async () => {
  const room = 'cleanup';
  const old = msg({ room, time: Date.now() - 7 * DAY - 60_000 });
  const fresh = msg({ room, time: Date.now() - 7 * DAY + 60_000 });
  await db.insertMessage(old);
  await db.insertMessage(fresh);
  await db.toggleReaction(old.id, '👍', 'x');
  await db.toggleReaction(fresh.id, '👍', 'x');

  await db.cleanupOldMessages();
  const left = await db.getRecentMessages(room, 10);
  assert.deepEqual(left.map((m) => m.id), [fresh.id]);
  assert.deepEqual(left[0].reactions, { '👍': ['x'] });
  // 지워진 메시지의 리액션이 남아있지 않은지 (다시 누르면 새로 "추가"됨)
  assert.deepEqual(await db.toggleReaction(old.id, '👍', 'x'), { '👍': ['x'] });
  await db.toggleReaction(old.id, '👍', 'x');

  await db.cleanupOldMessages(); // 정리할 게 없어도 에러 없이 끝남
  assert.equal((await db.getRecentMessages(room, 10)).length, 1);
});

// ---------------------------------------------------------------- 푸시 구독

test('푸시 구독: 저장/조회/방 이동(덮어쓰기)/삭제', async () => {
  const sub = { endpoint: 'https://push.example/a', clientId: 'c1', room: 'push-room', p256dh: 'key1', auth: 'auth1' };
  await db.saveSubscription(sub);
  await db.saveSubscription({ ...sub, endpoint: 'https://push.example/b', clientId: 'c2', room: 'push-room' });
  await db.saveSubscription({ ...sub, endpoint: 'https://push.example/c', clientId: 'c3', room: 'other-room' });

  const inRoom = await db.getSubscriptionsForRoom('push-room');
  assert.deepEqual(inRoom.map((s) => s.endpoint).sort(), ['https://push.example/a', 'https://push.example/b']);
  const a = inRoom.find((s) => s.endpoint.endsWith('/a'));
  assert.equal(a.clientId, 'c1');
  assert.equal(a.p256dh, 'key1');
  assert.equal(a.auth, 'auth1');

  // 같은 endpoint로 다시 저장하면 새 정보로 덮어씀 (방 이동)
  await db.saveSubscription({ ...sub, room: 'other-room', clientId: 'c1-new', p256dh: 'key2', auth: 'auth2' });
  assert.deepEqual((await db.getSubscriptionsForRoom('push-room')).map((s) => s.endpoint), ['https://push.example/b']);
  const moved = (await db.getSubscriptionsForRoom('other-room')).find((s) => s.endpoint.endsWith('/a'));
  assert.equal(moved.clientId, 'c1-new');
  assert.equal(moved.p256dh, 'key2');

  await db.removeSubscription('https://push.example/b');
  assert.deepEqual(await db.getSubscriptionsForRoom('push-room'), []);
  await db.removeSubscription('https://push.example/없음'); // 없는 것을 지워도 에러 없음
});

// ---------------------------------------------------------------- 프로필 사진

test('프로필 사진: 없으면 null, 저장하면 조회되고, 다시 저장하면 덮어쓴다', async () => {
  assert.equal(await db.getAvatar('avatar-none'), null);

  const before = Date.now();
  await db.setAvatar('avatar-user', 'data:image/png;base64,AAAA');
  const first = await db.getAvatar('avatar-user');
  assert.equal(first.image, 'data:image/png;base64,AAAA');
  assert.ok(first.updatedAt >= before);

  await db.setAvatar('avatar-user', 'data:image/png;base64,BBBB');
  assert.equal((await db.getAvatar('avatar-user')).image, 'data:image/png;base64,BBBB');
  assert.equal(await db.getAvatar('avatar-other'), null, '닉네임별로 분리');
});

// ---------------------------------------------------------------- 고정 메시지 / 내보내기

const pin = (id, over = {}) => ({ id, type: 'text', preview: `미리보기 ${id}`, nickname: 'nick', time: Date.now(), pinnedAt: Date.now(), ...over });

test('고정: 추가/중복/개수 상한/최근 고정순 목록/해제', async () => {
  const room = 'pins-unit';
  assert.equal(await db.addPin(room, pin('p1', { pinnedAt: 1000 }), 2), 'ok');
  assert.equal(await db.addPin(room, pin('p1'), 2), 'exists');
  assert.equal(await db.addPin(room, pin('p2', { pinnedAt: 2000 }), 2), 'ok');
  assert.equal(await db.addPin(room, pin('p3'), 2), 'full');
  assert.deepEqual((await db.listPins(room)).map((p) => p.id), ['p2', 'p1']); // 최근에 고정한 것부터
  assert.deepEqual(await db.listPins('다른방'), []);

  assert.equal(await db.removePin('다른방', 'p1'), false); // 다른 방에서는 못 풂
  assert.equal(await db.removePin(room, 'p1'), true);
  assert.equal(await db.removePin(room, 'p1'), false);
  assert.deepEqual((await db.listPins(room)).map((p) => p.id), ['p2']);
});

test('updatePinPreview: 고정된 메시지면 갱신하고 true, 아니면 false', async () => {
  await db.addPin('pins-upd', pin('u1'), 5);
  assert.equal(await db.updatePinPreview('u1', '바뀐 글'), true);
  assert.equal((await db.listPins('pins-upd'))[0].preview, '바뀐 글');
  assert.equal(await db.updatePinPreview('nope', 'x'), false);
});

test('cleanupOldMessages: 고정된 메시지는 7일이 지나도 지우지 않는다', async () => {
  const room = 'pins-cleanup';
  const old = Date.now() - 8 * DAY;
  const keep = msg({ room, time: old });
  const drop = msg({ room, time: old + 1 });
  await db.insertMessage(keep);
  await db.insertMessage(drop);
  await db.addPin(room, pin(keep.id), 5);
  await db.cleanupOldMessages();
  const left = (await db.getRecentMessages(room, 10)).map((m) => m.id);
  assert.deepEqual(left, [keep.id]);
});

test('getMessageById: 있으면 방 정보와 함께, 없으면 null', async () => {
  const m = msg({ room: 'by-id' });
  await db.insertMessage(m);
  const found = await db.getMessageById(m.id);
  assert.equal(found.room, 'by-id');
  assert.equal(found.content, m.content);
  assert.equal(await db.getMessageById('없는-id'), null);
});

test('getMessagesForExport: 시간순, 사진 본문/식별자/리액션 제외, 답장·수정 정보 포함, limit은 최근 쪽 기준', async () => {
  const room = 'export-unit';
  const base = Date.now() - 10_000;
  await db.insertMessage(msg({ room, content: '첫째', time: base }));
  await db.insertMessage(msg({ room, type: 'image', content: 'data:image/png;base64,AAAA', time: base + 1 }));
  const third = msg({ room, content: '셋째', time: base + 2, replyTo: { id: 'x', nickname: '철수', preview: '원문' } });
  await db.insertMessage(third);
  await db.editMessage(third.id, third.clientId, '셋째(수정)');

  const rows = await db.getMessagesForExport(room, 10);
  assert.deepEqual(rows.map((r) => r.content), ['첫째', '', '셋째(수정)']);
  assert.equal('clientId' in rows[0], false);
  assert.equal(rows[2].edited, true);
  assert.deepEqual(rows[2].replyTo, { id: 'x', nickname: '철수', preview: '원문' });
  assert.deepEqual((await db.getMessagesForExport(room, 2)).map((r) => r.content), ['', '셋째(수정)']);
});
