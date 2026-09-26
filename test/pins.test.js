// 메시지 고정 (메모리 모드): 누구나 고정/해제, 방마다 상한, 삭제하면 같이 풀림, 새로 들어오면 목록을 받음.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, start } = require('../server');
const { setBaseUrl, waitFor, collectDuring, connectClient, closeClient, join, withClients } = require('./helpers/socket-harness');

before(async () => setBaseUrl(`http://localhost:${await start(0)}`));
after(() => server.close());

async function say(sock, content) {
  const echoed = waitFor(sock, 'chat-message', (m) => m.content === content.trim());
  sock.emit('chat-message', { type: 'text', content });
  return echoed;
}

test('방 사람 누구나 메시지를 고정하고, 모두가 고정 목록을 받는다', async () => {
  await withClients([{ nickname: 'a', room: 'pin-basic' }, { nickname: 'b', room: 'pin-basic' }], async ([a, b]) => {
    const msg = await say(a, '  공지: 내일   회식  ');
    const pinsA = waitFor(a, 'pins', (p) => p.length === 1);
    const pinsB = waitFor(b, 'pins', (p) => p.length === 1);
    b.emit('pin-message', { messageId: msg.id }); // 작성자가 아닌 b가 고정
    const [gotA, gotB] = await Promise.all([pinsA, pinsB]);
    assert.deepEqual(gotA, gotB);
    assert.equal(gotA[0].id, msg.id);
    assert.equal(gotA[0].preview, '공지: 내일 회식'); // 공백 정리된 한 줄 미리보기
    assert.equal(gotA[0].nickname, 'a');
    assert.equal(gotA[0].type, 'text');
    assert.equal('clientId' in gotA[0], false);
  });
});

test('같은 메시지를 다시 고정해도 중복되지 않고, 해제하면 목록에서 빠진다', async () => {
  await withClients([{ nickname: 'a', room: 'pin-dup' }], async ([a]) => {
    const msg = await say(a, '중요');
    const first = waitFor(a, 'pins', (p) => p.length === 1);
    a.emit('pin-message', { messageId: msg.id });
    await first;

    const extra = collectDuring(a, 'pins', () => true, 250);
    a.emit('pin-message', { messageId: msg.id });
    assert.deepEqual(await extra, []); // 이미 고정돼 있으면 새 브로드캐스트 없음

    const removed = waitFor(a, 'pins', (p) => p.length === 0);
    a.emit('unpin-message', { messageId: msg.id });
    assert.deepEqual(await removed, []);
  });
});

test('사진/스티커/GIF는 라벨로, 고정 목록은 최근 고정순으로 온다', async () => {
  await withClients([{ nickname: 'a', room: 'pin-kinds' }], async ([a]) => {
    const text = await say(a, '글');
    const gifUrl = 'https://media1.giphy.com/media/x/200w.gif';
    const gifEcho = waitFor(a, 'chat-message', (m) => m.type === 'gif');
    a.emit('chat-message', { type: 'gif', content: gifUrl });
    const gif = await gifEcho;
    const imgEcho = waitFor(a, 'chat-message', (m) => m.type === 'image');
    a.emit('chat-message', { type: 'image', content: 'data:image/png;base64,AAAA' });
    const img = await imgEcho;

    for (const m of [text, gif, img]) {
      const updated = waitFor(a, 'pins', (p) => p.some((x) => x.id === m.id));
      a.emit('pin-message', { messageId: m.id });
      await updated;
      await new Promise((r) => setTimeout(r, 5)); // pinnedAt(ms) 순서 보장
    }
    const list = await new Promise((resolve) => {
      const onPins = (p) => p.length === 3 && (a.off('pins', onPins), resolve(p));
      a.on('pins', onPins);
      a.emit('unpin-message', { messageId: 'no-such' }); // 변화 없음
      a.emit('pin-message', { messageId: text.id }); // 이미 있음 — 변화 없음
      // 새 접속자에게 가는 목록을 대신 확인하려고 다시 입장
      a.emit('join', { nickname: 'a', room: 'pin-kinds', clientId: 'a' });
    });
    assert.deepEqual(list.map((p) => p.preview), ['사진', 'GIF', '글']);
    assert.deepEqual(list.map((p) => p.type), ['image', 'gif', 'text']);
  });
});

test('방마다 고정은 10개까지, 넘으면 pin-error', async () => {
  // 도배 방지(소켓당 5초에 8개)에 안 걸리게 두 명이 나눠서 보냄
  await withClients([{ nickname: 'a', room: 'pin-full' }, { nickname: 'b', room: 'pin-full' }], async ([a, b]) => {
    const ids = [];
    for (let i = 0; i < 11; i++) ids.push((await say(i % 2 ? b : a, `m${i}`)).id);
    for (let i = 0; i < 10; i++) {
      const done = waitFor(a, 'pins', (p) => p.length === i + 1);
      a.emit('pin-message', { messageId: ids[i] });
      await done;
    }
    const err = waitFor(a, 'pin-error');
    a.emit('pin-message', { messageId: ids[10] });
    assert.match(await err, /최대 10개/);
  });
});

test('다른 방의 메시지나 없는 메시지는 고정할 수 없다', async () => {
  await withClients([{ nickname: 'a', room: 'pin-room-a' }, { nickname: 'c', room: 'pin-room-c' }], async ([a, c]) => {
    const msg = await say(a, '방 A의 글');
    const err1 = waitFor(c, 'pin-error');
    c.emit('pin-message', { messageId: msg.id });
    await err1;
    const err2 = waitFor(c, 'pin-error');
    c.emit('pin-message', { messageId: 'does-not-exist' });
    await err2;
  });
});

test('고정된 메시지를 삭제하면 고정도 함께 풀린다', async () => {
  await withClients([{ nickname: 'a', room: 'pin-del' }, { nickname: 'b', room: 'pin-del' }], async ([a, b]) => {
    const msg = await say(a, '지울 공지');
    const pinned = waitFor(b, 'pins', (p) => p.length === 1);
    a.emit('pin-message', { messageId: msg.id });
    await pinned;
    const cleared = waitFor(b, 'pins', (p) => p.length === 0);
    a.emit('delete-message', { messageId: msg.id });
    assert.deepEqual(await cleared, []);
  });
});

test('나중에 입장한 사람도 지금까지의 고정 목록을 받는다 (다른 방 것은 안 받음)', async () => {
  await withClients([{ nickname: 'a', room: 'pin-late' }], async ([a]) => {
    const msg = await say(a, '먼저 고정된 글');
    const pinned = waitFor(a, 'pins', (p) => p.length === 1);
    a.emit('pin-message', { messageId: msg.id });
    await pinned;

    const late = connectClient();
    const other = connectClient();
    try {
      const gotPins = waitFor(late, 'pins');
      await join(late, { nickname: 'late', room: 'pin-late' });
      assert.deepEqual((await gotPins).map((p) => p.id), [msg.id]);
      const otherPins = waitFor(other, 'pins');
      await join(other, { nickname: 'other', room: 'pin-elsewhere' });
      assert.deepEqual(await otherPins, []);
    } finally {
      await closeClient(late);
      await closeClient(other);
    }
  });
});

test('입장하지 않은 소켓의 고정 요청은 무시된다', async () => {
  const lurker = connectClient();
  try {
    const got = collectDuring(lurker, 'pins', () => true, 250);
    const err = collectDuring(lurker, 'pin-error', () => true, 250);
    lurker.emit('pin-message', { messageId: 'x' });
    assert.deepEqual(await got, []);
    assert.deepEqual(await err, []);
  } finally {
    await closeClient(lurker);
  }
});

test('DB가 없으면 대화 내보내기는 available:false로 답한다', async () => {
  await withClients([{ nickname: 'a', room: 'export-nodb' }], async ([a]) => {
    const res = await new Promise((resolve) => a.emit('export-messages', {}, resolve));
    assert.deepEqual(res, { available: false, messages: [], truncated: false });
  });
});
