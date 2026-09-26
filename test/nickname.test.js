// 같은 방에서 닉네임 중복 방지 (다른 사람만 막고, 같은 브라우저의 재연결/다른 탭은 허용).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, start } = require('../server');
const { setBaseUrl, waitFor, waitForConnect, collectDuring, connectClient, closeClient, join, withClients } = require('./helpers/socket-harness');

before(async () => {
  setBaseUrl(`http://localhost:${await start(0)}`);
});

after(() => {
  server.close();
});

async function tryJoin(sock, data) {
  await waitForConnect(sock);
  const rejected = waitFor(sock, 'join-error');
  const accepted = waitFor(sock, 'joined');
  sock.emit('join', data);
  return Promise.race([rejected.then((msg) => ({ error: msg })), accepted.then((j) => ({ joined: j }))]);
}

test('같은 방에 다른 사람이 쓰는 닉네임이면 입장이 거절된다', async () => {
  await withClients([{ nickname: '철수', room: 'dup-a', clientId: 'id-1' }], async () => {
    const other = connectClient();
    try {
      const result = await tryJoin(other, { nickname: '철수', room: 'dup-a', clientId: 'id-2' });
      assert.match(result.error, /이미 사용 중/);
    } finally {
      await closeClient(other);
    }
  });
});

test('대소문자와 앞뒤 공백만 다른 닉네임도 중복으로 본다', async () => {
  await withClients([{ nickname: 'Alice', room: 'dup-case', clientId: 'id-1' }], async () => {
    const other = connectClient();
    try {
      const result = await tryJoin(other, { nickname: '  alice ', room: 'dup-case', clientId: 'id-2' });
      assert.ok(result.error);
    } finally {
      await closeClient(other);
    }
  });
});

test('다른 방이면 같은 닉네임을 써도 된다', async () => {
  await withClients([{ nickname: '철수', room: 'dup-room1', clientId: 'id-1' }], async () => {
    const other = connectClient();
    try {
      const result = await tryJoin(other, { nickname: '철수', room: 'dup-room2', clientId: 'id-2' });
      assert.ok(result.joined);
    } finally {
      await closeClient(other);
    }
  });
});

test('같은 clientId(같은 브라우저의 재연결/다른 탭)는 같은 닉네임으로 들어올 수 있다', async () => {
  await withClients([{ nickname: '철수', room: 'dup-same', clientId: 'same-id' }], async () => {
    const tab2 = connectClient();
    try {
      const result = await tryJoin(tab2, { nickname: '철수', room: 'dup-same', clientId: 'same-id' });
      assert.ok(result.joined);
    } finally {
      await closeClient(tab2);
    }
  });
});

test('거절된 소켓은 방에 들어가지 못해서 접속자 목록/메시지를 받지 않는다', async () => {
  await withClients([{ nickname: '철수', room: 'dup-ghost', clientId: 'id-1' }], async ([owner]) => {
    const other = connectClient();
    try {
      const result = await tryJoin(other, { nickname: '철수', room: 'dup-ghost', clientId: 'id-2' });
      assert.ok(result.error);
      const leaked = collectDuring(other, 'chat-message', () => true, 250);
      owner.emit('chat-message', { type: 'text', content: '비밀 이야기' });
      assert.deepEqual(await leaked, []);
    } finally {
      await closeClient(other);
    }
  });
});

test('나간 뒤에는 그 닉네임을 다른 사람이 쓸 수 있다', async () => {
  const first = connectClient();
  await join(first, { nickname: '철수', room: 'dup-free', clientId: 'id-1' });
  await closeClient(first);
  await new Promise((r) => setTimeout(r, 100));
  const second = connectClient();
  try {
    const result = await tryJoin(second, { nickname: '철수', room: 'dup-free', clientId: 'id-2' });
    assert.ok(result.joined);
  } finally {
    await closeClient(second);
  }
});
