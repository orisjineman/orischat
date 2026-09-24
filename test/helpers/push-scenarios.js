// push.js의 구독/알림 시나리오. 구독 저장소가 메모리든 DB든 똑같이 동작해야 해서
// 두 테스트 파일(push.test.js, push-db.test.js)이 같은 시나리오를 실행함.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { httpError } = require('./fake-webpush');

let counter = 0;
const unique = (prefix) => `${prefix}-${++counter}`;
const keys = { p256dh: 'p256dh-key', auth: 'auth-key' };

function defineScenarios(push, fake) {
  const subscribe = (over = {}) => {
    const sub = { endpoint: unique('https://push.example/ep'), clientId: unique('client'), room: unique('room'), keys, ...over };
    return push.subscribe(sub).then(() => sub);
  };

  test('구독한 사람에게 알림이 가고, 페이로드에는 보낸 사람 이름만 있고 메시지 내용은 없다', async () => {
    fake.reset();
    const room = unique('room');
    const sub = await subscribe({ room });

    await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'someone-else' });

    assert.equal(fake.calls.sent.length, 1);
    const { subscription, payload } = fake.calls.sent[0];
    assert.deepEqual(subscription, { endpoint: sub.endpoint, keys });
    assert.deepEqual(payload, { title: '철수님이 메시지를 보냈습니다', body: '확인하려면 클릭하세요' });
  });

  test('보낸 사람 본인과 다른 방 구독자에게는 알림이 가지 않는다', async () => {
    fake.reset();
    const room = unique('room');
    const sender = await subscribe({ room, clientId: 'sender-1' });
    const receiver = await subscribe({ room, clientId: 'receiver-1' });
    await subscribe({ room: unique('other-room') });

    await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'sender-1' });

    assert.deepEqual(fake.sentEndpoints(), [receiver.endpoint]);
    assert.ok(!fake.sentEndpoints().includes(sender.endpoint));
  });

  test('보낸 사람 이름이 없으면 "누군가"로 표시한다', async () => {
    fake.reset();
    const room = unique('room');
    await subscribe({ room });
    await push.notifyRoom(room, { excludeClientId: 'x' });
    assert.equal(fake.calls.sent[0].payload.title, '누군가님이 메시지를 보냈습니다');
  });

  test('구독자가 없는 방에 알림을 보내도 아무 일도 없다', async () => {
    fake.reset();
    await push.notifyRoom(unique('empty-room'), { nickname: '철수', excludeClientId: 'x' });
    assert.equal(fake.calls.sent.length, 0);
  });

  test('필수 값(endpoint, keys.p256dh, keys.auth)이 빠진 구독은 저장되지 않는다', async () => {
    fake.reset();
    const room = unique('room');
    await push.subscribe({ endpoint: '', clientId: 'c', room, keys });
    await push.subscribe({ endpoint: unique('ep'), clientId: 'c', room, keys: undefined });
    await push.subscribe({ endpoint: unique('ep'), clientId: 'c', room, keys: { p256dh: 'only' } });
    await push.subscribe({ endpoint: unique('ep'), clientId: 'c', room, keys: { auth: 'only' } });

    await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
    assert.equal(fake.calls.sent.length, 0);
  });

  test('구독 해제하면 더 이상 알림이 가지 않고, endpoint가 없거나 모르는 것을 해제해도 에러가 없다', async () => {
    fake.reset();
    const room = unique('room');
    const keep = await subscribe({ room });
    const drop = await subscribe({ room });

    await push.unsubscribe(drop.endpoint);
    await push.unsubscribe(undefined);
    await push.unsubscribe('');
    await push.unsubscribe('https://push.example/없음');

    await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
    assert.deepEqual(fake.sentEndpoints(), [keep.endpoint]);
  });

  test('같은 endpoint로 다시 구독하면 새 방/정보로 덮어쓴다 (방 이동)', async () => {
    fake.reset();
    const endpoint = unique('https://push.example/moving');
    const oldRoom = unique('room');
    const newRoom = unique('room');
    await push.subscribe({ endpoint, clientId: 'mover', room: oldRoom, keys });
    await push.subscribe({ endpoint, clientId: 'mover', room: newRoom, keys: { p256dh: 'new-p', auth: 'new-a' } });

    await push.notifyRoom(oldRoom, { nickname: 'x', excludeClientId: 'nobody' });
    assert.equal(fake.calls.sent.length, 0, '옛 방에는 더 이상 알림이 가지 않음');

    await push.notifyRoom(newRoom, { nickname: 'x', excludeClientId: 'nobody' });
    assert.equal(fake.calls.sent.length, 1);
    assert.deepEqual(fake.calls.sent[0].subscription, { endpoint, keys: { p256dh: 'new-p', auth: 'new-a' } });
  });

  for (const status of [404, 410]) {
    test(`푸시 서버가 ${status}(만료/취소)를 돌려주면 그 구독을 정리한다`, async () => {
      fake.reset();
      const room = unique('room');
      const alive = await subscribe({ room });
      const dead = await subscribe({ room });
      fake.failWith(dead.endpoint, httpError(status));

      await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
      assert.deepEqual(fake.sentEndpoints(), [alive.endpoint, dead.endpoint].sort(), '이번에는 둘 다 시도');

      fake.reset();
      await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
      assert.deepEqual(fake.sentEndpoints(), [alive.endpoint], '죽은 구독은 정리되어 더 이상 시도하지 않음');
    });
  }

  test('그 밖의 전송 오류는 로그만 남기고 구독은 유지하며, 다른 구독자 전송은 계속된다', async () => {
    fake.reset();
    const errorLog = mock.method(console, 'error', () => {});
    try {
      const room = unique('room');
      const flaky = await subscribe({ room });
      const healthy = await subscribe({ room });
      fake.failWith(flaky.endpoint, httpError(500, '푸시 서버 오류'));

      await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
      assert.deepEqual(fake.sentEndpoints(), [flaky.endpoint, healthy.endpoint].sort());
      assert.equal(errorLog.mock.calls.length, 1);
      assert.match(String(errorLog.mock.calls[0].arguments.join(' ')), /푸시 전송 오류.*푸시 서버 오류/);

      // 구독이 유지됐는지: 다음 알림에서도 다시 시도함
      fake.reset();
      await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
      assert.deepEqual(fake.sentEndpoints(), [flaky.endpoint, healthy.endpoint].sort());
    } finally {
      errorLog.mock.restore();
    }
  });

  test('statusCode가 없는 네트워크 오류도 구독을 지우지 않는다', async () => {
    fake.reset();
    const errorLog = mock.method(console, 'error', () => {});
    try {
      const room = unique('room');
      const sub = await subscribe({ room });
      fake.failWith(sub.endpoint, new Error('ECONNRESET'));

      await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
      fake.reset();
      await push.notifyRoom(room, { nickname: '철수', excludeClientId: 'x' });
      assert.deepEqual(fake.sentEndpoints(), [sub.endpoint]);
    } finally {
      errorLog.mock.restore();
    }
  });
}

module.exports = { defineScenarios };
