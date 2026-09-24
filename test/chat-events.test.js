// 소켓 이벤트별 동작(입장 정리, 메시지 검증, 리액션, 삭제/수정 권한, 입력 중, 읽음 표시,
// 요청 제한)을 DB 없는 메모리 모드에서 확인하는 테스트.
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
  sleep,
} = require('./helpers/socket-harness');

before(async () => {
  const port = await start(0);
  setBaseUrl(`http://localhost:${port}`);
});

after(() => {
  server.close();
});

// 채팅 메시지를 보내고 (같은 방 사람들 중) 받는 쪽이 받은 페이로드를 돌려줌
async function sendAndReceive(sender, receiver, payload, predicate = () => true) {
  const received = waitFor(receiver, 'chat-message', predicate);
  sender.emit('chat-message', payload);
  return received;
}

// ---------------------------------------------------------------- 입장

test('구버전 클라이언트처럼 닉네임 문자열만 보내도 기본 방에 입장한다', async () => {
  const sock = connectClient();
  try {
    await waitForConnect(sock);
    const joined = waitFor(sock, 'joined');
    sock.emit('join', '옛날손님');
    assert.deepEqual(await joined, { nickname: '옛날손님', clientId: sock.id, room: 'general' });
  } finally {
    await closeClient(sock);
  }
});

test('닉네임은 앞뒤 공백을 지우고 20자로 자르며, 비어 있으면 손님 이름이 붙는다', async () => {
  const long = connectClient();
  const empty = connectClient();
  try {
    const a = await join(long, { nickname: `  ${'가'.repeat(25)}  `, room: 'sanitize-nick' });
    assert.equal(a.nickname, '가'.repeat(20));
    const b = await join(empty, { nickname: '   ', room: 'sanitize-nick' });
    assert.match(b.nickname, /^손님/);
  } finally {
    await closeClient(long);
    await closeClient(empty);
  }
});

test('방 이름은 30자로 자르고, 비어 있으면 general이 된다', async () => {
  const a = connectClient();
  const b = connectClient();
  try {
    assert.equal((await join(a, { nickname: 'a', room: `  ${'x'.repeat(40)}` })).room, 'x'.repeat(30));
    assert.equal((await join(b, { nickname: 'b', room: '   ' })).room, 'general');
  } finally {
    await closeClient(a);
    await closeClient(b);
  }
});

test('입장하면 방 사람들에게 안내와 접속자 목록이 가고, 퇴장하면 다시 간다', async () => {
  const alice = connectClient();
  const bob = connectClient();
  try {
    await join(alice, { nickname: 'alice', room: 'presence' });

    const system = waitFor(alice, 'system-message');
    const list = waitFor(alice, 'user-list', (l) => l.includes('bob'));
    await join(bob, { nickname: 'bob', room: 'presence' });
    assert.equal(await system, 'bob님이 입장했습니다.');
    assert.deepEqual((await list).sort(), ['alice', 'bob']);

    const leaveSystem = waitFor(alice, 'system-message', (m) => m.includes('퇴장'));
    const leaveList = waitFor(alice, 'user-list', (l) => !l.includes('bob'));
    await closeClient(bob);
    assert.equal(await leaveSystem, 'bob님이 퇴장했습니다.');
    assert.deepEqual(await leaveList, ['alice']);
  } finally {
    await closeClient(alice);
    await closeClient(bob);
  }
});

test('같은 소켓이 다른 방으로 다시 입장하면 이전 방 메시지는 더 이상 받지 않는다', async () => {
  const mover = connectClient();
  const stayer = connectClient();
  const newcomer = connectClient();
  try {
    await join(mover, { nickname: 'mover', room: 'move-old' });
    await join(stayer, { nickname: 'stayer', room: 'move-old' });
    await join(newcomer, { nickname: 'newcomer', room: 'move-new' });
    await join(mover, { nickname: 'mover', room: 'move-new' });

    const oldRoomMsgs = collectDuring(mover, 'chat-message', (m) => m.content === '옛 방 메시지');
    stayer.emit('chat-message', { type: 'text', content: '옛 방 메시지' });
    assert.equal((await oldRoomMsgs).length, 0);

    const got = await sendAndReceive(newcomer, mover, { type: 'text', content: '새 방 메시지' });
    assert.equal(got.content, '새 방 메시지');
  } finally {
    await Promise.all([mover, stayer, newcomer].map(closeClient));
  }
});

// ---------------------------------------------------------------- 메시지

test('입장하지 않은 소켓이 보낸 메시지는 무시된다', async () => {
  await withClients([{ nickname: 'listener', room: 'anon-room' }], async ([listener]) => {
    const anon = connectClient();
    try {
      await waitForConnect(anon);
      const msgs = collectDuring(listener, 'chat-message');
      anon.emit('chat-message', { type: 'text', content: '몰래' });
      assert.equal((await msgs).length, 0);
    } finally {
      await closeClient(anon);
    }
  });
});

test('텍스트 메시지: 공백을 지우고 500자로 자르며, 빈 메시지는 무시한다', async () => {
  await withClients(
    [
      { nickname: 'writer', room: 'text-rules' },
      { nickname: 'reader', room: 'text-rules' },
    ],
    async ([writer, reader]) => {
      const trimmed = await sendAndReceive(writer, reader, { type: 'text', content: `   ${'가'.repeat(600)}   ` });
      assert.equal(trimmed.content, '가'.repeat(500));

      const empties = collectDuring(reader, 'chat-message');
      writer.emit('chat-message', { type: 'text', content: '     ' });
      writer.emit('chat-message', { type: 'text' });
      writer.emit('chat-message', {});
      assert.equal((await empties).length, 0);
    }
  );
});

test('구버전 클라이언트처럼 문자열만 보내도 텍스트 메시지로 처리된다', async () => {
  await withClients(
    [
      { nickname: 'old-writer', room: 'legacy-msg' },
      { nickname: 'old-reader', room: 'legacy-msg' },
    ],
    async ([writer, reader]) => {
      const msg = await sendAndReceive(writer, reader, '그냥 문자열');
      assert.equal(msg.type, 'text');
      assert.equal(msg.content, '그냥 문자열');
    }
  );
});

test('메시지 페이로드: 서버가 id/시각을 붙이고 clientId는 내려주지 않는다', async () => {
  await withClients(
    [
      { nickname: 'p-writer', room: 'payload' },
      { nickname: 'p-reader', room: 'payload' },
    ],
    async ([writer, reader]) => {
      const before = Date.now();
      const msg = await sendAndReceive(writer, reader, { type: 'text', content: '내용' });
      assert.match(msg.id, /^[0-9a-f-]{36}$/);
      assert.ok(msg.time >= before && msg.time <= Date.now());
      assert.equal(msg.nickname, 'p-writer');
      assert.equal(msg.replyTo, null);
      assert.deepEqual(msg.mentions, []);
      assert.deepEqual(msg.reactions, {});
      assert.equal(msg.edited, false);
      assert.equal('clientId' in msg, false);
    }
  );
});

test('@닉네임으로 방에 있는 사람을 부르면 mentions에 담긴다 (없는 사람은 제외)', async () => {
  await withClients(
    [
      { nickname: 'boss', room: 'mention' },
      { nickname: '김철수', room: 'mention' },
    ],
    async ([boss, chulsoo]) => {
      const msg = await sendAndReceive(boss, chulsoo, { type: 'text', content: '@김철수 확인해줘 @없는사람' });
      assert.deepEqual(msg.mentions, ['김철수']);

      const plain = await sendAndReceive(boss, chulsoo, { type: 'text', content: '김철수 확인' });
      assert.deepEqual(plain.mentions, []);
    }
  );
});

test('스티커: 실제 있는 파일만 전송되고, 없는 파일/경로 조작은 무시된다', async () => {
  await withClients(
    [
      { nickname: 's-writer', room: 'sticker-rules' },
      { nickname: 's-reader', room: 'sticker-rules' },
    ],
    async ([writer, reader]) => {
      const [name] = await (await fetch(`${getBaseUrl()}/api/stickers`)).json();
      const ok = await sendAndReceive(writer, reader, { type: 'sticker', content: name });
      assert.equal(ok.type, 'sticker');
      assert.equal(ok.content, name);

      const bad = collectDuring(reader, 'chat-message');
      writer.emit('chat-message', { type: 'sticker', content: '없는스티커.png' });
      writer.emit('chat-message', { type: 'sticker', content: `../${name}` });
      writer.emit('chat-message', { type: 'sticker', content: '../server.js' });
      const received = await bad;
      // '../<name>'은 basename 처리로 실제 스티커 이름이 되므로 통과하고, 나머지 둘은 무시됨
      assert.deepEqual(received.map((m) => m.content), [name]);
    }
  );
});

test('사진: 이미지 data URL만 받고, 이미지가 아니거나 너무 크면 upload-error', async () => {
  await withClients(
    [
      { nickname: 'i-writer', room: 'image-rules' },
      { nickname: 'i-reader', room: 'image-rules' },
    ],
    async ([writer, reader]) => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AAQ';
      const ok = await sendAndReceive(writer, reader, { type: 'image', content: dataUrl });
      assert.equal(ok.type, 'image');
      assert.equal(ok.content, dataUrl);

      const notImage = waitFor(writer, 'upload-error');
      writer.emit('chat-message', { type: 'image', content: 'data:text/html;base64,AAAA' });
      assert.match(await notImage, /이미지 용량/);

      const tooBig = waitFor(writer, 'upload-error');
      writer.emit('chat-message', { type: 'image', content: `data:image/jpeg;base64,${'A'.repeat(700_000)}` });
      assert.match(await tooBig, /이미지 용량/);
    }
  );
});

test('답장 대상은 길이만 제한하고, id가 없으면 무시한다', async () => {
  await withClients(
    [
      { nickname: 'r-writer', room: 'reply-rules' },
      { nickname: 'r-reader', room: 'reply-rules' },
    ],
    async ([writer, reader]) => {
      const withReply = await sendAndReceive(writer, reader, {
        type: 'text',
        content: '답장',
        replyTo: { id: 'i'.repeat(200), nickname: 'n'.repeat(50), preview: 'p'.repeat(300) },
      });
      assert.equal(withReply.replyTo.id.length, 100);
      assert.equal(withReply.replyTo.nickname.length, 20);
      assert.equal(withReply.replyTo.preview.length, 120);

      const noId = await sendAndReceive(
        writer,
        reader,
        { type: 'text', content: '답장2', replyTo: { nickname: 'x', preview: 'y' } },
        (m) => m.content === '답장2'
      );
      assert.equal(noId.replyTo, null);
    }
  );
});

// ---------------------------------------------------------------- 리액션

test('같은 이모지를 다시 누르면 취소된다', async () => {
  await withClients(
    [
      { nickname: 'toggler', room: 'react-toggle' },
      { nickname: 'watcher', room: 'react-toggle' },
    ],
    async ([toggler, watcher]) => {
      const msg = await sendAndReceive(watcher, toggler, { type: 'text', content: '토글' });

      const first = waitFor(toggler, 'reaction-update', (u) => u.messageId === msg.id);
      toggler.emit('react', { messageId: msg.id, emoji: '👍' });
      assert.equal((await first).reactions['👍'].count, 1);

      const second = waitFor(toggler, 'reaction-update', (u) => u.messageId === msg.id);
      toggler.emit('react', { messageId: msg.id, emoji: '👍' });
      assert.deepEqual((await second).reactions, {});
    }
  );
});

test('다른 방의 메시지에는 반응할 수 없다', async () => {
  await withClients(
    [
      { nickname: 'owner', room: 'react-home' },
      { nickname: 'friend', room: 'react-home' },
      { nickname: 'outsider', room: 'react-away' },
    ],
    async ([owner, friend, outsider]) => {
      const msg = await sendAndReceive(owner, friend, { type: 'text', content: '외부인 금지' });

      const leaked = Promise.all([
        collectDuring(owner, 'reaction-update'),
        collectDuring(outsider, 'reaction-update'),
      ]);
      outsider.emit('react', { messageId: msg.id, emoji: '👍' });
      const [ownerEvents, outsiderEvents] = await leaked;
      assert.equal(ownerEvents.length + outsiderEvents.length, 0);
    }
  );
});

test('반응을 너무 빨리 누르면 rate-limited(react)가 온다', async () => {
  await withClients([{ nickname: 'react-spammer', room: 'react-limit' }], async ([sock]) => {
    const limited = waitFor(sock, 'rate-limited');
    for (let i = 0; i < 25; i++) sock.emit('react', { messageId: 'nope', emoji: '👍' });
    assert.equal((await limited).action, 'react');
  });
});

// ---------------------------------------------------------------- 삭제 / 수정

test('삭제: 작성자라도 다른 방에서는 지울 수 없고, 모르는 id는 무시된다', async () => {
  const author = connectClient();
  const reader = connectClient();
  const authorElsewhere = connectClient();
  try {
    await join(author, { nickname: 'author', room: 'del-home', clientId: 'same-client' });
    await join(reader, { nickname: 'reader', room: 'del-home' });
    await join(authorElsewhere, { nickname: 'author2', room: 'del-away', clientId: 'same-client' });

    const msg = await sendAndReceive(author, reader, { type: 'text', content: '지켜야 할 메시지' });

    const deleted = collectDuring(reader, 'message-deleted');
    authorElsewhere.emit('delete-message', { messageId: msg.id });
    author.emit('delete-message', { messageId: 'unknown-id' });
    author.emit('delete-message', {});
    assert.equal((await deleted).length, 0);

    // 같은 방에서 작성자가 지우는 건 성공
    const ok = waitFor(reader, 'message-deleted');
    author.emit('delete-message', { messageId: msg.id });
    assert.equal((await ok).messageId, msg.id);
  } finally {
    await Promise.all([author, reader, authorElsewhere].map(closeClient));
  }
});

test('삭제된 메시지를 다시 삭제해도 아무 일도 일어나지 않는다', async () => {
  await withClients(
    [
      { nickname: 'twice', room: 'del-twice' },
      { nickname: 'twice-reader', room: 'del-twice' },
    ],
    async ([author, reader]) => {
      const msg = await sendAndReceive(author, reader, { type: 'text', content: '한 번만' });
      const first = waitFor(reader, 'message-deleted');
      author.emit('delete-message', { messageId: msg.id });
      await first;

      const again = collectDuring(reader, 'message-deleted');
      author.emit('delete-message', { messageId: msg.id });
      assert.equal((await again).length, 0);
    }
  );
});

test('수정은 DB가 있어야 동작한다 (메모리 모드에서는 아무 일도 없음)', async () => {
  await withClients(
    [
      { nickname: 'editor', room: 'edit-nodb' },
      { nickname: 'editor-reader', room: 'edit-nodb' },
    ],
    async ([editor, reader]) => {
      const msg = await sendAndReceive(editor, reader, { type: 'text', content: '원본' });
      const edited = collectDuring(reader, 'message-edited');
      editor.emit('edit-message', { messageId: msg.id, content: '수정본' });
      assert.equal((await edited).length, 0);
    }
  );
});

// ---------------------------------------------------------------- 입력 중 / 읽음

test('입력 중 표시는 나를 뺀 방 사람들에게만 간다', async () => {
  await withClients(
    [
      { nickname: 'typer', room: 'typing' },
      { nickname: 'typing-watcher', room: 'typing' },
      { nickname: 'typing-other-room', room: 'typing-else' },
    ],
    async ([typer, watcher, other]) => {
      const seen = waitFor(watcher, 'typing');
      const own = collectDuring(typer, 'typing');
      const otherRoom = collectDuring(other, 'typing');
      typer.emit('typing', true);
      assert.deepEqual(await seen, { nickname: 'typer', isTyping: true });
      assert.equal((await own).length, 0);
      assert.equal((await otherRoom).length, 0);

      const stopped = waitFor(watcher, 'typing', (t) => !t.isTyping);
      typer.emit('typing', false);
      assert.equal((await stopped).nickname, 'typer');
    }
  );
});

test('읽음 표시: 나를 뺀 사람들이 최소 어디까지 읽었는지가 각자에게 전달된다', async () => {
  await withClients(
    [
      { nickname: 'reader-a', room: 'read-status' },
      { nickname: 'reader-b', room: 'read-status' },
    ],
    async ([a, b]) => {
      const aSees = waitFor(a, 'read-update', (u) => u.minReadTime === 5000);
      const bSees = waitFor(b, 'read-update', (u) => u.minReadTime === 0);
      b.emit('mark-read', { time: 5000 });
      await aSees; // a 입장에서 "나 외 모두(b)"가 5000까지 읽음
      await bSees; // b 입장에서 "나 외 모두(a)"는 아직 안 읽음

      const bSeesA = waitFor(b, 'read-update', (u) => u.minReadTime === 3000);
      a.emit('mark-read', { time: 3000 });
      await bSeesA;
      await sleep(100); // a 자신에게 가는 같은 갱신 패킷이 다 도착한 뒤에 검사

      // 이미 읽은 시각보다 과거 값은 무시됨 (갱신 알림 없음)
      const regress = collectDuring(a, 'read-update');
      b.emit('mark-read', { time: 4000 });
      assert.equal((await regress).length, 0);
    }
  );
});

test('읽음 표시: 나간 사람은 기준에서 빠진다', async () => {
  const a = connectClient();
  const b = connectClient();
  const c = connectClient();
  try {
    await join(a, { nickname: 'ra', room: 'read-leave' });
    await join(b, { nickname: 'rb', room: 'read-leave' });
    await join(c, { nickname: 'rc', room: 'read-leave' });

    // b가 9000까지 읽었지만 c는 아직 안 읽음 → a 기준 min = 0
    b.emit('mark-read', { time: 9000 });
    await sleep(100);
    const afterLeave = waitFor(a, 'read-update', (u) => u.minReadTime === 9000);
    await closeClient(c); // c가 나가면 남은 건 b뿐 → 9000
    assert.equal((await afterLeave).minReadTime, 9000);
  } finally {
    await Promise.all([a, b, c].map(closeClient));
  }
});

// ---------------------------------------------------------------- 조회 계열 (DB 없음)

test('검색/이전 메시지 더 보기는 DB가 없으면 빈 배열로 응답한다', async () => {
  await withClients([{ nickname: 'lonely', room: 'nodb-queries' }], async ([sock]) => {
    const search = await new Promise((resolve) => sock.emit('search-messages', { query: '뭐든' }, resolve));
    assert.deepEqual(search, []);
    const more = await new Promise((resolve) => sock.emit('load-more', { beforeTime: Date.now() }, resolve));
    assert.deepEqual(more, []);
  });
});

test('콜백 없이 보낸 search/load-more 요청은 조용히 무시된다', async () => {
  await withClients([{ nickname: 'no-callback', room: 'nodb-nocb' }], async ([sock]) => {
    sock.emit('search-messages', { query: 'x' });
    sock.emit('load-more', { beforeTime: 1 });
    await sleep(100);
    assert.ok(sock.connected);
  });
});

test('푸시 구독 요청이 잘못되어도 서버는 죽지 않는다', async () => {
  await withClients([{ nickname: 'pusher', room: 'push-bad' }], async ([sock]) => {
    sock.emit('push-subscribe', null);
    sock.emit('push-subscribe', {});
    sock.emit('push-subscribe', { endpoint: 'https://example.com/x', keys: {} });
    sock.emit('push-unsubscribe', {});
    sock.emit('push-unsubscribe');
    await sleep(100);
    assert.ok(sock.connected);
  });
});
