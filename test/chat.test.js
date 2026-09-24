// 서버의 핵심 동작(입장, 메시지, 리액션, 삭제, 방 분리, 요청 제한)을 실제로
// 소켓으로 연결해서 확인하는 통합 테스트. DB(Turso) 환경변수가 없는 상태로
// 돌기 때문에 메모리 폴백 경로를 검증함.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { server, start } = require('../server');
const { setBaseUrl, connectClient, waitFor, closeClient, join } = require('./helpers/socket-harness');

before(async () => {
  const port = await start(0);
  setBaseUrl(`http://localhost:${port}`);
});

after(() => {
  server.close();
});

test('입장하면 닉네임/방 정보를 받는다', async () => {
  const alice = connectClient();
  try {
    const joined = await join(alice, { nickname: 'alice', room: 'test-basic' });
    assert.equal(joined.nickname, 'alice');
    assert.equal(joined.room, 'test-basic');
  } finally {
    await closeClient(alice);
  }
});

test('내가 보낸 메시지는 mine:true로, 다른 사람 것은 mine:false로 온다', async () => {
  const alice = connectClient();
  const bob = connectClient();
  try {
    await join(alice, { nickname: 'alice', room: 'test-mine' });
    await join(bob, { nickname: 'bob', room: 'test-mine' });

    // 두 소켓 모두 리스너를 먼저 걸어둔 뒤에 emit해야 함. 순서를 반대로 하면
    // (emit → alice 기다림 → bob 기다림) 서버가 거의 동시에 보내는 두 패킷 중
    // bob 몫이 bob용 리스너가 걸리기도 전에 도착해서 그냥 사라져버릴 수 있음
    // (Socket.IO는 나중에 붙는 리스너를 위해 지난 이벤트를 보관해주지 않음).
    const aliceMsgPromise = waitFor(alice, 'chat-message', (m) => m.content === '안녕');
    const bobMsgPromise = waitFor(bob, 'chat-message', (m) => m.content === '안녕');
    alice.emit('chat-message', { type: 'text', content: '안녕' });
    const [aliceView, bobView] = await Promise.all([aliceMsgPromise, bobMsgPromise]);

    assert.equal(aliceView.mine, true);
    assert.equal(bobView.mine, false);
    assert.equal(bobView.nickname, 'alice');
    // 다른 사람에게는 영구 식별자(clientId)가 그대로 노출되면 안 됨
    assert.equal('clientId' in bobView, false);
  } finally {
    await closeClient(alice);
    await closeClient(bob);
  }
});

test('서로 다른 방은 메시지가 섞이지 않는다', async () => {
  const alice = connectClient();
  const carol = connectClient();
  try {
    await join(alice, { nickname: 'alice', room: 'room-a' });
    await join(carol, { nickname: 'carol', room: 'room-b' });

    let leaked = false;
    alice.on('chat-message', (m) => {
      if (m.content === 'room-b 전용 메시지') leaked = true;
    });

    carol.emit('chat-message', { type: 'text', content: 'room-b 전용 메시지' });
    await waitFor(carol, 'chat-message', (m) => m.content === 'room-b 전용 메시지');

    // 다른 방 이벤트가 도착할 시간을 살짝 준 뒤 확인
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(leaked, false);
  } finally {
    await closeClient(alice);
    await closeClient(carol);
  }
});

test('이모지 리액션은 누른 사람 기준 mine이 다르게 보인다', async () => {
  const alice = connectClient();
  const bob = connectClient();
  try {
    await join(alice, { nickname: 'alice', room: 'test-react' });
    await join(bob, { nickname: 'bob', room: 'test-react' });

    bob.emit('chat-message', { type: 'text', content: '반응해줘' });
    const msg = await waitFor(alice, 'chat-message', (m) => m.content === '반응해줘');

    // (위 mine:true 테스트와 같은 이유로) 두 리스너를 먼저 걸어두고 emit함
    const aliceReactionPromise = waitFor(alice, 'reaction-update', (u) => u.messageId === msg.id);
    const bobReactionPromise = waitFor(bob, 'reaction-update', (u) => u.messageId === msg.id);
    alice.emit('react', { messageId: msg.id, emoji: '👍' });
    const [aliceView, bobView] = await Promise.all([aliceReactionPromise, bobReactionPromise]);

    assert.equal(aliceView.reactions['👍'].count, 1);
    assert.equal(aliceView.reactions['👍'].mine, true);
    assert.equal(bobView.reactions['👍'].count, 1);
    assert.equal(bobView.reactions['👍'].mine, false);
  } finally {
    await closeClient(alice);
    await closeClient(bob);
  }
});

test('본인 메시지만 삭제할 수 있다', async () => {
  const alice = connectClient();
  const bob = connectClient();
  try {
    await join(alice, { nickname: 'alice', room: 'test-delete' });
    await join(bob, { nickname: 'bob', room: 'test-delete' });

    alice.emit('chat-message', { type: 'text', content: '지워질 메시지' });
    const msg = await waitFor(bob, 'chat-message', (m) => m.content === '지워질 메시지');

    // 작성자가 아닌 bob이 삭제를 시도하면 무시되어야 함
    bob.emit('delete-message', { messageId: msg.id });
    let wronglyDeleted = false;
    const spy = () => {
      wronglyDeleted = true;
    };
    alice.on('message-deleted', spy);
    await new Promise((r) => setTimeout(r, 200));
    alice.off('message-deleted', spy);
    assert.equal(wronglyDeleted, false);

    // 작성자 본인은 삭제할 수 있어야 함
    alice.emit('delete-message', { messageId: msg.id });
    const deleted = await waitFor(bob, 'message-deleted', (d) => d.messageId === msg.id);
    assert.equal(deleted.messageId, msg.id);
  } finally {
    await closeClient(alice);
    await closeClient(bob);
  }
});

test('짧은 시간에 메시지를 너무 많이 보내면 rate-limited가 온다', async () => {
  const alice = connectClient();
  try {
    await join(alice, { nickname: 'alice', room: 'test-ratelimit' });

    const limitedPromise = waitFor(alice, 'rate-limited');
    for (let i = 0; i < 15; i++) {
      alice.emit('chat-message', { type: 'text', content: `spam ${i}` });
    }
    const limited = await limitedPromise;
    assert.equal(limited.action, 'chat-message');
  } finally {
    await closeClient(alice);
  }
});
