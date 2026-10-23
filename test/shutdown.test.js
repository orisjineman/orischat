// 정상 종료(stop) — 서버를 닫으면 접속 중인 클라이언트가 바로 끊김을 알고, 새 연결은
// 받지 않아야 함. 서버를 닫아버리므로 다른 테스트와 섞이지 않게 파일을 따로 둠.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { server, start, stop } = require('../server');
const { setBaseUrl, getBaseUrl, waitFor, connectClient, join } = require('./helpers/socket-harness');

before(async () => {
  setBaseUrl(`http://localhost:${await start(0)}`);
});

test('stop()은 접속 중인 소켓을 끊고 HTTP 서버를 닫는다', async () => {
  const sock = connectClient();
  await join(sock, { nickname: '종료테스트' });

  const disconnected = waitFor(sock, 'disconnect');
  await stop();

  // 'io server disconnect'(서버가 명시적으로 끊음)였다면 클라이언트가 자동 재연결을 안 함.
  // 전송 계층이 닫힌 것으로 보여야 새 인스턴스로 알아서 다시 붙음.
  assert.equal(await disconnected, 'transport close');
  assert.equal(server.listening, false);
  await assert.rejects(fetch(`${getBaseUrl()}/api/config`));
  sock.close();
});
