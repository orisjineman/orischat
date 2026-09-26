// HTTP 엔드포인트(설정, 방 목록, 스티커, 프로필 사진, 정적 파일)와, 프로필 사진의
// 메모리 폴백 경로(DB 없음)를 확인하는 테스트.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { server, start } = require('../server');
const { setBaseUrl, getBaseUrl, waitFor, collectDuring, withClients } = require('./helpers/socket-harness');

before(async () => {
  const port = await start(0);
  setBaseUrl(`http://localhost:${port}`);
});

after(() => {
  server.close();
});

const get = (p) => fetch(`${getBaseUrl()}${p}`);

test('/api/config: 비밀번호/푸시가 설정되지 않은 상태를 알려준다', async () => {
  const res = await get('/api/config');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { pinRequired: false, pushPublicKey: null, gifEnabled: false });
});

test('/api/stickers: public/stickers 폴더의 이미지 파일 목록을 정렬해서 준다', async () => {
  const expected = fs
    .readdirSync(path.join(__dirname, '..', 'public', 'stickers'))
    .filter((n) => ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(path.extname(n).toLowerCase()))
    .sort();
  assert.ok(expected.length > 0, '테스트하려면 스티커가 최소 하나는 있어야 함');
  const res = await get('/api/stickers');
  assert.deepEqual(await res.json(), expected);
});

test('/stickers/:filename: 있는 스티커는 이미지로, 없거나 경로 조작이면 404', async () => {
  const [name] = await (await get('/api/stickers')).json();
  const ok = await get(`/stickers/${encodeURIComponent(name)}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /^image\//);
  assert.ok((await ok.arrayBuffer()).byteLength > 0);

  assert.equal((await get('/stickers/없는스티커.png')).status, 404);
  assert.equal((await get('/stickers/..%2Fserver.js')).status, 404);
  assert.equal((await get('/stickers/..%2F..%2Fpackage.json')).status, 404);
});

test('정적 파일: 메인 페이지와 클라이언트 모듈이 제공된다', async () => {
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.match(await index.text(), /OrisChat/);

  const mod = await get('/js/messages.js');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /javascript/);
});

test('/avatar/:nickname: 등록된 적 없는 닉네임은 404', async () => {
  assert.equal((await get('/avatar/nobody-http')).status, 404);
});

test('/api/rooms: 접속 중인 방을 인원수와 함께 접속자 많은 순으로 보여준다', async () => {
  await withClients(
    [
      { nickname: 'r1', room: 'rooms-big' },
      { nickname: 'r2', room: 'rooms-big' },
      { nickname: 'r3', room: 'rooms-small' },
    ],
    async () => {
      const rooms = await (await get('/api/rooms')).json();
      const big = rooms.find((r) => r.name === 'rooms-big');
      const small = rooms.find((r) => r.name === 'rooms-small');
      assert.equal(big.activeUsers, 2);
      assert.equal(small.activeUsers, 1);
      assert.ok(rooms.indexOf(big) < rooms.indexOf(small));
    }
  );
});

// 1x1 PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('프로필 사진을 올리면 방 사람들에게 알리고, 이미지 바이트로 내려준다', async () => {
  await withClients(
    [
      { nickname: 'avatar-owner', room: 'avatar-room' },
      { nickname: 'avatar-viewer', room: 'avatar-room' },
    ],
    async ([owner, viewer]) => {
      const ownerEvent = waitFor(owner, 'avatar-updated');
      const viewerEvent = waitFor(viewer, 'avatar-updated');
      owner.emit('set-avatar', { content: `data:image/png;base64,${PNG_BASE64}` });
      const [a, b] = await Promise.all([ownerEvent, viewerEvent]);
      assert.equal(a.nickname, 'avatar-owner');
      assert.equal(typeof a.updatedAt, 'number');
      assert.deepEqual(a, b);

      const res = await get('/avatar/avatar-owner');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.match(res.headers.get('cache-control'), /max-age=86400/);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PNG_BASE64, 'base64'));
    }
  );
});

test('프로필 사진: 이미지가 아니거나 용량이 크면 거절한다', async () => {
  await withClients([{ nickname: 'avatar-bad', room: 'avatar-room-bad' }], async ([sock]) => {
    const notImage = waitFor(sock, 'upload-error');
    sock.emit('set-avatar', { content: 'data:text/plain;base64,AAAA' });
    assert.match(await notImage, /프로필 사진/);

    const tooBig = waitFor(sock, 'upload-error');
    sock.emit('set-avatar', { content: `data:image/png;base64,${'A'.repeat(250_001)}` });
    assert.match(await tooBig, /프로필 사진/);

    assert.equal((await get('/avatar/avatar-bad')).status, 404);
  });
});

test('프로필 사진: 입장하지 않은 소켓의 요청은 무시된다', async () => {
  await withClients([{ nickname: 'avatar-watch', room: 'avatar-room-anon' }], async ([watcher]) => {
    const { connectClient, waitForConnect, closeClient } = require('./helpers/socket-harness');
    const anon = connectClient();
    try {
      await waitForConnect(anon);
      anon.emit('set-avatar', { content: `data:image/png;base64,${PNG_BASE64}` });
      const events = await collectDuring(watcher, 'avatar-updated');
      assert.equal(events.length, 0);
    } finally {
      await closeClient(anon);
    }
  });
});
