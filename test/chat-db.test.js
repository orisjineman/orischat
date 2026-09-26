// DB가 켜진 상태(Turso 대신 로컬 libSQL 파일)에서의 동작 — 대화 기록 복원, 페이지네이션,
// 검색, 수정, 삭제, 리액션 영속, 프로필 사진 저장, 방 목록, 오래된 메시지 정리.
// DB 연결은 db.js를 불러오는 시점에 정해져서, 환경 변수를 먼저 설정하고 이 파일만
// 따로 실행함(node --test는 파일마다 별도 프로세스).
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orischat-db-'));
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, start } = require('../server');
const db = require('../db');
const {
  setBaseUrl,
  getBaseUrl,
  waitFor,
  collectDuring,
  connectClient,
  closeClient,
  join,
  withClients,
  sleep,
} = require('./helpers/socket-harness');

before(async () => {
  const port = await start(0);
  setBaseUrl(`http://localhost:${port}`);
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// 메시지를 보내고, 보낸 사람이 자기 메시지를 돌려받을 때까지(=DB 저장 끝) 기다림
async function say(sock, content, extra = {}) {
  const echoed = waitFor(sock, 'chat-message', (m) => m.content === content);
  sock.emit('chat-message', { type: 'text', content, ...extra });
  return echoed;
}

// 새 클라이언트를 입장시켜서 서버가 보내는 history를 받아옴
async function fetchHistory({ nickname, room, clientId }) {
  const sock = connectClient();
  try {
    const history = waitFor(sock, 'history');
    await join(sock, { nickname, room, clientId });
    return await history;
  } finally {
    await closeClient(sock);
  }
}

test('입장하면 방의 지난 대화가 history로 오고, 내 메시지만 mine:true다', async () => {
  const room = 'db-history';
  await withClients([{ nickname: 'hist-alice', room, clientId: 'alice-id' }], async ([alice]) => {
    await say(alice, '첫째');
    await say(alice, '둘째');
    await say(alice, '셋째');
  });

  const asBob = await fetchHistory({ nickname: 'hist-bob', room, clientId: 'bob-id' });
  assert.deepEqual(asBob.map((m) => m.content), ['첫째', '둘째', '셋째']);
  assert.ok(asBob.every((m) => m.mine === false && m.nickname === 'hist-alice'));
  assert.ok(asBob.every((m) => !('clientId' in m)), 'clientId는 내려가면 안 됨');

  const asAlice = await fetchHistory({ nickname: 'hist-alice', room, clientId: 'alice-id' });
  assert.ok(asAlice.every((m) => m.mine === true));
});

test('history는 방별로 분리된다', async () => {
  await withClients([{ nickname: 'iso-a', room: 'db-iso-a' }], async ([a]) => {
    await say(a, 'A방 메시지');
  });
  const other = await fetchHistory({ nickname: 'iso-b', room: 'db-iso-b' });
  assert.deepEqual(other, []);
});

test('답장 정보와 수정 여부, 리액션(개수/mine)이 history에 그대로 복원된다', async () => {
  const room = 'db-history-meta';
  await withClients(
    [
      { nickname: 'meta-alice', room, clientId: 'meta-alice-id' },
      { nickname: 'meta-bob', room, clientId: 'meta-bob-id' },
    ],
    async ([alice, bob]) => {
      const original = await say(alice, '원본');
      const reply = await say(bob, '답장이야', { replyTo: { id: original.id, nickname: 'meta-alice', preview: '원본' } });

      const reacted = waitFor(alice, 'reaction-update', (u) => u.messageId === reply.id);
      alice.emit('react', { messageId: reply.id, emoji: '❤️' });
      await reacted;

      const edited = waitFor(alice, 'message-edited');
      alice.emit('edit-message', { messageId: original.id, content: '고친 원본' });
      await edited;
    }
  );

  const asAlice = await fetchHistory({ nickname: 'meta-alice', room, clientId: 'meta-alice-id' });
  const [original, reply] = asAlice;
  assert.equal(original.content, '고친 원본');
  assert.equal(original.edited, true);
  assert.equal(reply.edited, false);
  assert.deepEqual(reply.replyTo, { id: original.id, nickname: 'meta-alice', preview: '원본' });
  assert.deepEqual(reply.reactions, { '❤️': { count: 1, mine: true } });

  const asCarol = await fetchHistory({ nickname: 'meta-carol', room, clientId: 'meta-carol-id' });
  assert.deepEqual(asCarol[1].reactions, { '❤️': { count: 1, mine: false } });
});

test('이전 메시지 더 보기: 50개씩 과거로 거슬러 올라가고, 끝이면 빈 배열', async () => {
  const room = 'db-paging';
  const base = Date.now() - 60_000;
  for (let i = 0; i < 120; i++) {
    await db.insertMessage({
      id: `page-${i}`,
      type: 'text',
      content: `m${i}`,
      nickname: 'seed',
      clientId: 'seed-id',
      room,
      time: base + i,
      replyTo: null,
    });
  }

  const sock = connectClient();
  try {
    const historyPromise = waitFor(sock, 'history');
    await join(sock, { nickname: 'pager', room });
    const history = await historyPromise;
    assert.equal(history.length, 50);
    assert.equal(history[0].content, 'm70');
    assert.equal(history[49].content, 'm119');

    const ask = (beforeTime) => new Promise((resolve) => sock.emit('load-more', { beforeTime }, resolve));
    const page2 = await ask(history[0].time);
    assert.equal(page2.length, 50);
    assert.equal(page2[0].content, 'm20');
    assert.equal(page2[49].content, 'm69');
    assert.ok(page2.every((m) => m.mine === false));

    const page3 = await ask(page2[0].time);
    assert.equal(page3.length, 20);
    assert.equal(page3[0].content, 'm0');

    assert.deepEqual(await ask(page3[0].time), []);
    assert.deepEqual(await ask(0), []);
    assert.deepEqual(await new Promise((r) => sock.emit('load-more', {}, r)), []);
  } finally {
    await closeClient(sock);
  }
});

test('검색: 같은 방의 텍스트 메시지를 최신순으로 찾고, %/_ 같은 문자도 글자 그대로 검색한다', async () => {
  await withClients(
    [
      { nickname: 'searcher', room: 'db-search' },
      { nickname: 'searcher-other', room: 'db-search-other' },
    ],
    async ([sock, other]) => {
      await say(sock, 'Apple pie');
      await sleep(5);
      await say(sock, '바나나');
      await sleep(5);
      await say(sock, 'apple tart');
      await say(sock, '할인 100% 진행');
      await say(sock, 'a_b');
      await say(other, '다른 방 apple');

      const search = (query) => new Promise((resolve) => sock.emit('search-messages', { query }, resolve));

      const apples = await search('apple');
      assert.deepEqual(apples.map((m) => m.content), ['apple tart', 'Apple pie']); // 최신순, 대소문자 무시, 다른 방 제외
      assert.ok(apples.every((m) => m.mine === true && !('clientId' in m)));

      assert.deepEqual((await search('%')).map((m) => m.content), ['할인 100% 진행']);
      assert.deepEqual((await search('_')).map((m) => m.content), ['a_b']);
      assert.deepEqual(await search('없는말'), []);
      assert.deepEqual(await search('   '), []);
    }
  );
});

test('검색 결과에는 스티커/사진이 포함되지 않는다', async () => {
  await withClients([{ nickname: 'search-media', room: 'db-search-media' }], async ([sock]) => {
    const [name] = await (await fetch(`${getBaseUrl()}/api/stickers`)).json();
    const echoed = waitFor(sock, 'chat-message', (m) => m.type === 'sticker');
    sock.emit('chat-message', { type: 'sticker', content: name });
    await echoed;
    const results = await new Promise((resolve) => sock.emit('search-messages', { query: name.slice(0, 2) }, resolve));
    assert.deepEqual(results, []);
  });
});

test('수정: 작성자만 텍스트 메시지를 고칠 수 있고, 방 전체에 알려지고 DB에 반영된다', async () => {
  const room = 'db-edit';
  await withClients(
    [
      { nickname: 'edit-author', room, clientId: 'edit-author-id' },
      { nickname: 'edit-other', room, clientId: 'edit-other-id' },
    ],
    async ([author, other]) => {
      const msg = await say(author, '고치기 전');

      // 다른 사람이 고치려 하면 무시
      const hijack = Promise.all([collectDuring(author, 'message-edited'), collectDuring(other, 'message-edited')]);
      other.emit('edit-message', { messageId: msg.id, content: '해킹' });
      const [a, b] = await hijack;
      assert.equal(a.length + b.length, 0);

      // 빈 내용은 무시
      const empty = collectDuring(other, 'message-edited');
      author.emit('edit-message', { messageId: msg.id, content: '   ' });
      assert.equal((await empty).length, 0);

      // 작성자는 성공 (공백 제거, 500자 제한)
      const seenByOther = waitFor(other, 'message-edited');
      const seenByAuthor = waitFor(author, 'message-edited');
      author.emit('edit-message', { messageId: msg.id, content: `  ${'가'.repeat(600)}  ` });
      const [o, m] = await Promise.all([seenByOther, seenByAuthor]);
      assert.equal(o.messageId, msg.id);
      assert.equal(o.content, '가'.repeat(500));
      assert.equal(typeof o.editedAt, 'number');
      assert.deepEqual(o, m);
    }
  );

  const history = await fetchHistory({ nickname: 'edit-viewer', room });
  assert.equal(history[0].content, '가'.repeat(500));
  assert.equal(history[0].edited, true);
});

test('수정: 스티커/사진 메시지는 고칠 수 없다', async () => {
  await withClients([{ nickname: 'edit-sticker', room: 'db-edit-media' }], async ([sock]) => {
    const [name] = await (await fetch(`${getBaseUrl()}/api/stickers`)).json();
    const echoed = waitFor(sock, 'chat-message', (m) => m.type === 'sticker');
    sock.emit('chat-message', { type: 'sticker', content: name });
    const msg = await echoed;

    const edited = collectDuring(sock, 'message-edited');
    sock.emit('edit-message', { messageId: msg.id, content: '텍스트로 바꾸기' });
    assert.equal((await edited).length, 0);
  });
});

test('삭제하면 DB에서도 사라져서 이후 입장한 사람에게 보이지 않는다', async () => {
  const room = 'db-delete';
  await withClients(
    [
      { nickname: 'del-author', room, clientId: 'del-author-id' },
      { nickname: 'del-other', room, clientId: 'del-other-id' },
    ],
    async ([author, other]) => {
      const keep = await say(author, '남길 메시지');
      const gone = await say(author, '지울 메시지');

      // 남이 지우려는 건 무시
      const hijack = collectDuring(author, 'message-deleted');
      other.emit('delete-message', { messageId: gone.id });
      assert.equal((await hijack).length, 0);

      const deleted = waitFor(other, 'message-deleted');
      author.emit('delete-message', { messageId: gone.id });
      assert.equal((await deleted).messageId, gone.id);
      void keep;
    }
  );

  const history = await fetchHistory({ nickname: 'del-viewer', room });
  assert.deepEqual(history.map((m) => m.content), ['남길 메시지']);
});

test('리액션은 DB에 저장되어, 토글로 취소하면 history에서도 사라진다', async () => {
  const room = 'db-react';
  await withClients(
    [
      { nickname: 'react-a', room, clientId: 'react-a-id' },
      { nickname: 'react-b', room, clientId: 'react-b-id' },
    ],
    async ([a, b]) => {
      const msg = await say(a, '반응 대상');
      const both = Promise.all([
        waitFor(a, 'reaction-update', (u) => u.reactions['👍']?.count === 2),
        waitFor(b, 'reaction-update', (u) => u.reactions['👍']?.count === 2),
      ]);
      a.emit('react', { messageId: msg.id, emoji: '👍' });
      await sleep(50);
      b.emit('react', { messageId: msg.id, emoji: '👍' });
      const [viewA, viewB] = await both;
      assert.equal(viewA.reactions['👍'].mine, true);
      assert.equal(viewB.reactions['👍'].mine, true);

      // b가 취소 → 1명만 남음
      const cancelled = waitFor(a, 'reaction-update', (u) => u.reactions['👍']?.count === 1);
      b.emit('react', { messageId: msg.id, emoji: '👍' });
      assert.equal((await cancelled).reactions['👍'].mine, true);
    }
  );

  const history = await fetchHistory({ nickname: 'react-c', room });
  assert.deepEqual(history[0].reactions, { '👍': { count: 1, mine: false } });
});

test('프로필 사진은 DB에 저장되어 이미지로 내려온다', async () => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await withClients([{ nickname: 'db-avatar', room: 'db-avatar-room' }], async ([sock]) => {
    const updated = waitFor(sock, 'avatar-updated');
    sock.emit('set-avatar', { content: `data:image/png;base64,${png}` });
    await updated;
  });

  const res = await fetch(`${getBaseUrl()}/avatar/db-avatar`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(png, 'base64'));

  // 같은 닉네임으로 다시 올리면 덮어씀
  assert.equal((await db.getAvatar('db-avatar')).image.startsWith('data:image/png'), true);
});

test('/api/rooms: 기록이 있는 방은 접속자가 없어도 목록에 나오고, 접속자 수가 합쳐진다', async () => {
  const room = 'db-rooms';
  await withClients([{ nickname: 'rooms-a', room }], async ([sock]) => {
    await say(sock, '방 기록 남기기');
  });

  let rooms = await (await fetch(`${getBaseUrl()}/api/rooms`)).json();
  const offline = rooms.find((r) => r.name === room);
  assert.equal(offline.activeUsers, 0);
  assert.ok(offline.lastActivity > 0);

  await withClients([{ nickname: 'rooms-b', room }], async () => {
    rooms = await (await fetch(`${getBaseUrl()}/api/rooms`)).json();
    const online = rooms.find((r) => r.name === room);
    assert.equal(online.activeUsers, 1);
    assert.equal(online.lastActivity, offline.lastActivity);
    assert.equal(rooms[0].name === room || rooms[0].activeUsers === 0, true);
  });
});

test('7일이 지난 메시지는 리액션과 함께 정리되고, 최근 메시지는 남는다', async () => {
  const room = 'db-cleanup';
  const day = 24 * 60 * 60 * 1000;
  await db.insertMessage({ id: 'old-1', type: 'text', content: '오래됨', nickname: 'x', clientId: 'x', room, time: Date.now() - 8 * day });
  await db.insertMessage({ id: 'new-1', type: 'text', content: '최근', nickname: 'x', clientId: 'x', room, time: Date.now() - 6 * day });
  await db.toggleReaction('old-1', '👍', 'someone');
  await db.toggleReaction('new-1', '👍', 'someone');

  await db.cleanupOldMessages();

  const history = await db.getRecentMessages(room, 50);
  assert.deepEqual(history.map((m) => m.id), ['new-1']);
  assert.deepEqual(history[0].reactions, { '👍': ['someone'] });
  assert.deepEqual(await db.toggleReaction('old-1', '👍', 'someone'), { '👍': ['someone'] }, '옛 리액션이 남아 있었다면 취소되어 빈 값이 됐을 것');
});

test('서버 재시작처럼 권한 캐시가 비어 있어도, history를 받은 뒤엔 내 옛 메시지를 지우고 고칠 수 있다', async () => {
  // 이 프로세스에서 보낸 메시지는 메모리 캐시에 이미 있으므로, DB에 직접 넣어서
  // "서버가 이 메시지를 기억하지 못하는" 상태를 만듦.
  const room = 'db-perm';
  await db.insertMessage({ id: 'perm-del', type: 'text', content: '지울 옛 메시지', nickname: 'perm-me', clientId: 'perm-me-id', room, time: Date.now() - 1000 });
  await db.insertMessage({ id: 'perm-others', type: 'text', content: '남의 옛 메시지', nickname: 'other', clientId: 'other-id', room, time: Date.now() - 900 });

  const sock = connectClient();
  try {
    // history를 받기 전에는 서버가 이 메시지의 주인을 모르므로 삭제가 무시됨
    const historyPromise = waitFor(sock, 'history'); // join보다 먼저 걸어야 놓치지 않음
    await join(sock, { nickname: 'perm-me', room, clientId: 'perm-me-id' });
    const history = await historyPromise;
    assert.deepEqual(history.map((m) => m.mine), [true, false]);

    // 남의 옛 메시지는 못 지움
    const wrong = collectDuring(sock, 'message-deleted');
    sock.emit('delete-message', { messageId: 'perm-others' });
    assert.equal((await wrong).length, 0);

    // 내 옛 메시지는 지움
    const deleted = waitFor(sock, 'message-deleted');
    sock.emit('delete-message', { messageId: 'perm-del' });
    assert.equal((await deleted).messageId, 'perm-del');
  } finally {
    await closeClient(sock);
  }

  const remaining = await db.getRecentMessages(room, 50);
  assert.deepEqual(remaining.map((m) => m.id), ['perm-others']);
});

test('load-until: 화면의 가장 오래된 메시지부터 찾는 시각까지 빈틈없이 한 번에 불러온다', async () => {
  const room = 'db-jump';
  const base = Date.now() - 50_000;
  for (let i = 0; i < 20; i++) {
    await db.insertMessage({ id: `jump-${i}`, type: 'text', content: `j${i}`, nickname: 'x', clientId: 'x', room, time: base + i, replyTo: null });
  }
  await withClients([{ nickname: 'jumper', room, clientId: 'jumper-id' }], async ([sock]) => {
    const older = await new Promise((resolve) => sock.emit('load-until', { fromTime: base + 3, beforeTime: base + 15 }, resolve));
    assert.deepEqual(older.map((m) => m.content), Array.from({ length: 12 }, (_, i) => `j${i + 3}`)); // 시간순, from 포함/before 제외
    assert.equal('clientId' in older[0], false);

    // 잘못된 요청은 빈 배열
    for (const bad of [{ fromTime: base + 10, beforeTime: base + 5 }, { fromTime: 'abc', beforeTime: base }, {}]) {
      assert.deepEqual(await new Promise((resolve) => sock.emit('load-until', bad, resolve)), []);
    }
  });
});
