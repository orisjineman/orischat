// CHAT_PIN(입장 비밀번호)이 설정된 서버의 동작을 확인하는 테스트.
// 환경 변수는 서버 모듈을 불러오기 전에 정해야 해서 이 파일만 따로 둠.
process.env.CHAT_PIN = '1234';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, start } = require('../server');
const {
  setBaseUrl,
  getBaseUrl,
  waitFor,
  collectDuring,
  connectClient,
  waitForConnect,
  closeClient,
  join,
  withClients,
} = require('./helpers/socket-harness');

before(async () => {
  const port = await start(0);
  setBaseUrl(`http://localhost:${port}`);
});

after(() => {
  server.close();
});

test('/api/config는 비밀번호가 필요하다고 알려준다', async () => {
  const res = await fetch(`${getBaseUrl()}/api/config`);
  assert.equal((await res.json()).pinRequired, true);
});

test('비밀번호가 없거나 틀리면 join-error, 맞으면 입장된다', async () => {
  for (const pin of [undefined, '', '0000', '12345']) {
    const sock = connectClient();
    try {
      await waitForConnect(sock);
      const error = waitFor(sock, 'join-error');
      const data = { nickname: 'guest', room: 'pin-room', clientId: 'guest' };
      if (pin !== undefined) data.pin = pin;
      sock.emit('join', data);
      assert.equal(await error, '비밀번호가 틀렸습니다.', `pin=${JSON.stringify(pin)}`);
    } finally {
      await closeClient(sock);
    }
  }

  const joined = await withClients([{ nickname: 'member', room: 'pin-room', pin: '1234' }], async ([sock]) => sock.connected);
  assert.equal(joined, true);
});

test('구버전 방식(문자열 닉네임)으로는 입장할 수 없다', async () => {
  const sock = connectClient();
  try {
    await waitForConnect(sock);
    const error = waitFor(sock, 'join-error');
    sock.emit('join', '옛날손님');
    assert.equal(await error, '비밀번호가 틀렸습니다.');
  } finally {
    await closeClient(sock);
  }
});

test('입장에 실패한 소켓은 메시지를 보내도 방에 전달되지 않는다', async () => {
  await withClients([{ nickname: 'insider', room: 'pin-secret', pin: '1234' }], async ([insider]) => {
    const intruder = connectClient();
    try {
      await waitForConnect(intruder);
      intruder.emit('join', { nickname: 'intruder', room: 'pin-secret', clientId: 'intruder', pin: 'wrong' });
      await waitFor(intruder, 'join-error');

      const msgs = collectDuring(insider, 'chat-message');
      intruder.emit('chat-message', { type: 'text', content: '침입' });
      assert.equal((await msgs).length, 0);
    } finally {
      await closeClient(intruder);
    }
  });
});

test('올바른 비밀번호로 입장하면 정상적으로 대화할 수 있다', async () => {
  await withClients(
    [
      { nickname: 'pin-a', room: 'pin-chat', pin: '1234' },
      { nickname: 'pin-b', room: 'pin-chat', pin: '1234' },
    ],
    async ([a, b]) => {
      const received = waitFor(b, 'chat-message');
      a.emit('chat-message', { type: 'text', content: '안녕' });
      assert.equal((await received).content, '안녕');
    }
  );
  void join;
});
