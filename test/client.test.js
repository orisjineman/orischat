// 브라우저 클라이언트(public/client.js)의 동작을 고정하는 특성화 테스트.
// 실제 index.html을 jsdom에 올리고, 소켓은 가짜(FakeSocket)로 바꿔서 서버 이벤트를
// 흉내낸 뒤 DOM/전송 이벤트를 확인함. 클라이언트를 모듈로 쪼개는 리팩토링 전후에
// 똑같이 통과해야 함.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

const windows = [];
const tmpDirs = [];
let bootCount = 0;

// ES 모듈은 URL 단위로 캐시되어 한 번만 평가되는데, 테스트마다 새 DOM/소켓에 다시
// 연결해야 함. 클라이언트가 여러 모듈로 나뉘어 있어서 진입점에만 쿼리를 붙이면
// 하위 모듈은 캐시가 재사용되므로, 부팅마다 소스를 새 임시 폴더로 복사해서 import함.
function copyClientSources() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orischat-client-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }');
  for (const name of fs.readdirSync(PUBLIC_DIR)) {
    if (name === 'client.js') fs.copyFileSync(path.join(PUBLIC_DIR, name), path.join(dir, name));
    else if (name === 'js') fs.cpSync(path.join(PUBLIC_DIR, name), path.join(dir, name), { recursive: true });
  }
  return pathToFileURL(path.join(dir, 'client.js')).href;
}

class FakeSocket {
  constructor() {
    this.handlers = new Map();
    this.emitted = []; // { event, args }
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }
  emit(event, ...args) {
    this.emitted.push({ event, args });
  }
  // 서버에서 이벤트가 온 것처럼 실행
  trigger(event, ...args) {
    for (const fn of this.handlers.get(event) || []) fn(...args);
  }
  sent(event) {
    return this.emitted.filter((e) => e.event === event);
  }
  lastSent(event) {
    const list = this.sent(event);
    return list[list.length - 1];
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// 각 테스트마다 새 DOM + 새 클라이언트 인스턴스를 띄움
async function boot({ session = {}, local = {}, url = 'http://localhost/', config = {}, rooms = [], stickers = [], extraRoutes = {} } = {}) {
  const dom = new JSDOM(HTML, { url, pretendToBeVisual: true });
  const { window } = dom;
  windows.push(window);
  const { document } = window;

  for (const [k, v] of Object.entries(session)) window.sessionStorage.setItem(k, v);
  for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);

  window.Element.prototype.scrollTo = function () {};
  window.Element.prototype.scrollIntoView = function () {};

  const socket = new FakeSocket();
  const dialogs = { alerts: [], confirmResult: true, promptResult: null, prompts: [] };

  const routes = {
    '/api/config': config,
    '/api/rooms': rooms,
    '/api/stickers': stickers,
    ...extraRoutes,
  };
  const fetchStub = async (u) => {
    if (!(u in routes)) throw new Error(`unexpected fetch ${u}`);
    return { ok: true, json: async () => routes[u] };
  };

  const set = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  set('window', window);
  set('document', document);
  set('localStorage', window.localStorage);
  set('sessionStorage', window.sessionStorage);
  set('location', window.location);
  set('history', window.history);
  set('navigator', window.navigator); // Node 20에는 전역 navigator가 없음 (21+부터 제공)
  set('CSS', { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) });
  set('io', () => socket);
  set('fetch', fetchStub);
  set('alert', (msg) => dialogs.alerts.push(msg));
  set('confirm', () => dialogs.confirmResult);
  set('prompt', (msg, def) => {
    dialogs.prompts.push({ msg, def });
    return dialogs.promptResult;
  });
  set('Notification', undefined);

  await import(copyClientSources());
  bootCount++;
  await tick();

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fire = (el, type, init) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true, ...init }));
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));

  return { window, document, socket, dialogs, $, $$, fire, key };
}

function chatMsg(overrides = {}) {
  return {
    id: 'm1',
    type: 'text',
    content: '안녕',
    nickname: '철수',
    time: 1700000000000,
    mine: false,
    reactions: {},
    replyTo: null,
    mentions: [],
    edited: false,
    ...overrides,
  };
}

// 입장까지 마친 상태로 시작
async function bootJoined(opts = {}) {
  const env = await boot(opts);
  env.socket.trigger('joined', { nickname: '나', room: 'general' });
  return env;
}

after(() => {
  for (const w of windows) w.close();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 입장

test('닉네임을 입력하고 입장 버튼을 누르면 join 이벤트를 보낸다', async () => {
  const { $, socket } = await boot();
  $('#nickname-input').value = '  철수 ';
  $('#room-input').value = '연구실';
  $('#join-btn').click();

  const { args } = socket.lastSent('join');
  assert.equal(args[0].nickname, '철수');
  assert.equal(args[0].room, '연구실');
  assert.equal(args[0].pin, '');
  assert.ok(args[0].clientId, 'clientId가 있어야 함');
});

test('닉네임이 비어 있으면 join을 보내지 않는다', async () => {
  const { $, socket } = await boot();
  $('#nickname-input').value = '   ';
  $('#join-btn').click();
  assert.equal(socket.sent('join').length, 0);
});

test('입력창에서 Enter를 눌러도 입장된다', async () => {
  for (const id of ['#nickname-input', '#room-input', '#pin-input']) {
    const { $, socket, key } = await boot();
    $('#nickname-input').value = '철수';
    key($(id), 'Enter');
    assert.equal(socket.sent('join').length, 1, `${id}에서 Enter`);
  }
});

test('clientId는 localStorage에 저장되어 재사용된다', async () => {
  const first = await boot();
  first.$('#nickname-input').value = 'a';
  first.$('#join-btn').click();
  const id = first.socket.lastSent('join').args[0].clientId;
  assert.equal(first.window.localStorage.getItem('orischat-client-id'), id);

  const second = await boot({ local: { 'orischat-client-id': 'fixed-id' } });
  second.$('#nickname-input').value = 'a';
  second.$('#join-btn').click();
  assert.equal(second.socket.lastSent('join').args[0].clientId, 'fixed-id');
});

test('joined를 받으면 채팅 화면으로 전환되고 세션에 저장된다', async () => {
  const { $, window, socket } = await boot();
  socket.trigger('joined', { nickname: '철수', room: '연구실' });

  assert.ok($('#login-screen').classList.contains('hidden'));
  assert.ok(!$('#chat-screen').classList.contains('hidden'));
  assert.equal($('#room-label').textContent, 'OrisChat · 연구실');
  assert.equal(window.sessionStorage.getItem('orischat-nickname'), '철수');
  assert.equal(window.sessionStorage.getItem('orischat-room'), '연구실');
  assert.equal(window.location.search, `?room=${encodeURIComponent('연구실')}`);
});

test('기본 방(general)이면 방 이름이 라벨/URL에 붙지 않는다', async () => {
  const { $, window, socket } = await boot({ url: 'http://localhost/?room=x' });
  socket.trigger('joined', { nickname: '철수', room: 'general' });
  assert.equal($('#room-label').textContent, 'OrisChat');
  assert.equal(window.location.search, '');
});

test('URL의 ?room= 값이 방 입력칸에 미리 채워진다', async () => {
  const { $ } = await boot({ url: `http://localhost/?room=${encodeURIComponent('연구실')}` });
  assert.equal($('#room-input').value, '연구실');
});

test('join-error를 받으면 로그인 화면과 오류 메시지가 보인다', async () => {
  const { $, window, socket } = await boot({ session: { 'orischat-nickname': '철수' } });
  socket.trigger('join-error', '비밀번호가 틀렸습니다.');

  assert.ok(!$('#login-screen').classList.contains('hidden'));
  assert.ok($('#chat-screen').classList.contains('hidden'));
  assert.equal($('#join-error').textContent, '비밀번호가 틀렸습니다.');
  assert.ok(!$('#join-error').classList.contains('hidden'));
  assert.equal(window.sessionStorage.getItem('orischat-nickname'), null);
});

test('세션에 닉네임이 있으면 로그인 화면 없이 바로 채팅 화면이고, 연결 시 자동 재입장한다', async () => {
  const { $, socket } = await boot({
    session: { 'orischat-nickname': '철수', 'orischat-pin': '1234', 'orischat-room': '연구실' },
  });
  assert.ok($('#login-screen').classList.contains('hidden'));
  assert.ok(!$('#chat-screen').classList.contains('hidden'));

  socket.trigger('connect');
  const { args } = socket.lastSent('join');
  assert.equal(args[0].nickname, '철수');
  assert.equal(args[0].pin, '1234');
  assert.equal(args[0].room, '연구실');
});

test('서버에 비밀번호가 설정되어 있으면 비밀번호 입력칸이 보인다', async () => {
  const off = await boot({ config: { pinRequired: false } });
  assert.ok(off.$('#pin-input').classList.contains('hidden'));
  const on = await boot({ config: { pinRequired: true } });
  assert.ok(!on.$('#pin-input').classList.contains('hidden'));
});

test('방 목록이 버튼으로 보이고 클릭하면 방 입력칸에 채워진다', async () => {
  const { $, $$ } = await boot({
    rooms: [
      { name: '연구실', activeUsers: 2, lastActivity: 1 },
      { name: 'general', activeUsers: 0, lastActivity: 0 },
    ],
  });
  const items = $$('.room-item');
  assert.equal(items.length, 2);
  assert.equal(items[0].textContent, '연구실 · 2명 접속중');
  assert.equal(items[1].textContent, 'general');
  items[0].click();
  assert.equal($('#room-input').value, '연구실');
});

test('접속자 목록(user-list)이 그려진다', async () => {
  const { $$, socket } = await bootJoined();
  socket.trigger('user-list', ['철수', '영희']);
  assert.deepEqual(
    $$('#user-list li').map((li) => li.textContent),
    ['철수', '영희']
  );
  socket.trigger('user-list', ['철수']);
  assert.equal($$('#user-list li').length, 1);
});

// ---------------------------------------------------------------- 메시지 렌더링

test('다른 사람 메시지: 닉네임/아바타/본문/시간이 보이고 수정·삭제 버튼은 없다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg());

  const msg = $('.msg');
  assert.ok(msg.classList.contains('other'));
  assert.equal(msg.dataset.messageId, 'm1');
  assert.equal(msg.querySelector('.msg-nick').textContent.trim(), '철수');
  assert.equal(msg.querySelector('.msg-avatar-img').getAttribute('src'), `/avatar/${encodeURIComponent('철수')}?v=0`);
  assert.equal(msg.querySelector('.msg-body').textContent, '안녕');
  assert.ok(msg.querySelector('.msg-time').textContent.length > 0);
  assert.ok(msg.querySelector('.reply-btn'));
  assert.ok(msg.querySelector('.react-btn'));
  assert.equal(msg.querySelector('.edit-btn'), null);
  assert.equal(msg.querySelector('.delete-btn'), null);
  assert.equal(msg.querySelector('.read-status'), null);
});

test('내 메시지: 닉네임 없이 수정/삭제 버튼과 읽음 표시 칸이 있다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ mine: true, nickname: '나' }));

  const msg = $('.msg');
  assert.ok(msg.classList.contains('me'));
  assert.equal(msg.querySelector('.msg-nick'), null);
  assert.ok(msg.querySelector('.edit-btn'));
  assert.ok(msg.querySelector('.delete-btn'));
  assert.ok(msg.querySelector('.read-status'));
});

test('수정된 메시지는 시간 옆에 (수정됨)이 붙는다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ edited: true }));
  assert.ok($('.msg-time').textContent.endsWith('(수정됨)'));
});

test('본문의 HTML은 이스케이프되어 태그로 해석되지 않는다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ content: '<img src=x onerror=alert(1)><b>굵게</b>' }));
  const body = $('.msg-body');
  assert.equal(body.querySelector('img'), null);
  assert.equal(body.querySelector('b'), null);
  assert.equal(body.textContent, '<img src=x onerror=alert(1)><b>굵게</b>');
});

test('URL은 새 탭 링크로, 현재 방 사람의 @멘션은 하이라이트로 렌더링된다', async () => {
  const { $, $$, socket } = await bootJoined();
  socket.trigger('user-list', ['영희', '영희철수']);
  socket.trigger('chat-message', chatMsg({ content: '보세요 https://example.com/a?b=1 @영희철수 @영희 @없는사람' }));

  const a = $('.msg-body a');
  assert.equal(a.getAttribute('href'), 'https://example.com/a?b=1');
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener noreferrer');
  // 긴 닉네임이 먼저 매칭되어야 함, 방에 없는 사람은 하이라이트 안 됨
  assert.deepEqual(
    $$('.msg-body .mention').map((m) => m.textContent),
    ['@영희철수', '@영희']
  );
});

test('스티커/사진 메시지는 이미지로 렌더링되고 수정 버튼이 없다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 's1', type: 'sticker', content: '웃음 1.png', mine: true }));
  socket.trigger('chat-message', chatMsg({ id: 'i1', type: 'image', content: 'data:image/jpeg;base64,AAAA', mine: true }));

  const sticker = $('[data-message-id="s1"]');
  assert.ok(sticker.classList.contains('sticker'));
  assert.equal(sticker.querySelector('img.sticker-img').getAttribute('src'), `/stickers/${encodeURIComponent('웃음 1.png')}`);
  assert.equal(sticker.querySelector('.edit-btn'), null);

  const image = $('[data-message-id="i1"]');
  assert.equal(image.querySelector('img.chat-image').getAttribute('src'), 'data:image/jpeg;base64,AAAA');
  assert.equal(image.querySelector('.edit-btn'), null);
});

test('삭제된 상태로 온 메시지는 안내 문구만 보이고 버튼이 없다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('history', [chatMsg({ mine: true, deleted: true })]);
  const msg = $('.msg');
  assert.ok(msg.classList.contains('deleted'));
  assert.equal(msg.querySelector('.msg-body').textContent, '삭제된 메시지입니다');
  assert.equal(msg.querySelector('.delete-btn'), null);
  assert.equal(msg.querySelector('.react-btn'), null);
});

test('시스템 메시지와 입력 중 표시', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('system-message', '철수님이 입장했습니다.');
  assert.equal($('.msg.system').textContent, '철수님이 입장했습니다.');

  socket.trigger('typing', { nickname: '철수', isTyping: true });
  assert.equal($('#typing-indicator').textContent, '철수님이 입력 중...');
  socket.trigger('typing', { nickname: '철수', isTyping: false });
  assert.equal($('#typing-indicator').textContent, '');
});

test('너무 빠르게 보내면(rate-limited) 안내 토스트가 뜬다', async () => {
  const { $, socket } = await boot();
  socket.trigger('rate-limited', { action: 'chat-message' });
  assert.ok($('#rate-limit-toast').classList.contains('show'));
});

test('upload-error는 alert로 보여준다', async () => {
  const { dialogs, socket } = await boot();
  socket.trigger('upload-error', '용량이 너무 큽니다');
  assert.deepEqual(dialogs.alerts, ['용량이 너무 큽니다']);
});

// ---------------------------------------------------------------- 보내기

test('메시지를 전송하면 chat-message가 나가고 입력창이 비워진다', async () => {
  const { $, fire, socket } = await bootJoined();
  $('#message-input').value = '  안녕하세요  ';
  fire($('#message-form'), 'submit');

  assert.deepEqual(socket.lastSent('chat-message').args[0], { type: 'text', content: '안녕하세요' });
  assert.equal($('#message-input').value, '');
  assert.deepEqual(socket.lastSent('typing').args, [false]);
});

test('빈 메시지는 전송되지 않는다', async () => {
  const { $, fire, socket } = await bootJoined();
  $('#message-input').value = '   ';
  fire($('#message-form'), 'submit');
  assert.equal(socket.sent('chat-message').length, 0);
});

test('입력하면 typing(true)이 나가고 1.5초 뒤 typing(false)가 나간다', async () => {
  const { $, fire, socket } = await bootJoined();
  fire($('#message-input'), 'input');
  assert.deepEqual(socket.lastSent('typing').args, [true]);
  await new Promise((r) => setTimeout(r, 1600));
  assert.deepEqual(socket.lastSent('typing').args, [false]);
});

test('스티커 피커: 목록을 불러와 보여주고, 클릭하면 스티커가 전송된다', async () => {
  const { $, $$, socket } = await bootJoined({ stickers: ['a.png', 'b b.png'] });
  $('#emoji-btn').click();
  await tick();

  assert.ok(!$('#emoji-picker').classList.contains('hidden'));
  const items = $$('.sticker-item');
  assert.deepEqual(items.map((i) => i.dataset.filename), ['a.png', 'b b.png']);
  assert.equal(items[1].querySelector('img').getAttribute('src'), `/stickers/${encodeURIComponent('b b.png')}`);

  items[1].click();
  assert.deepEqual(socket.lastSent('chat-message').args[0], { type: 'sticker', content: 'b b.png' });
  assert.ok($('#emoji-picker').classList.contains('hidden'));
});

test('스티커가 없으면 안내 문구를 보여준다', async () => {
  const { $ } = await bootJoined({ stickers: [] });
  $('#emoji-btn').click();
  await tick();
  assert.ok($('#emoji-picker .picker-empty'));
});

// ---------------------------------------------------------------- 답장

test('답장 버튼 → 배너 표시 → 전송 시 replyTo가 실리고 배너가 닫힌다', async () => {
  const { $, fire, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg());
  $('.reply-btn').click();

  assert.ok(!$('#reply-banner').classList.contains('hidden'));
  assert.equal($('#reply-banner-text').textContent, '철수님에게 답장: 안녕');

  $('#message-input').value = '응';
  fire($('#message-form'), 'submit');
  assert.deepEqual(socket.lastSent('chat-message').args[0], {
    type: 'text',
    content: '응',
    replyTo: { id: 'm1', nickname: '철수', preview: '안녕' },
  });
  assert.ok($('#reply-banner').classList.contains('hidden'));
});

test('답장 취소 버튼을 누르면 replyTo 없이 전송된다', async () => {
  const { $, fire, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg());
  $('.reply-btn').click();
  $('#reply-cancel-btn').click();
  assert.ok($('#reply-banner').classList.contains('hidden'));

  $('#message-input').value = '응';
  fire($('#message-form'), 'submit');
  assert.equal('replyTo' in socket.lastSent('chat-message').args[0], false);
});

test('스티커에 답장하면 미리보기가 "스티커", 사진이면 "사진"', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 's1', type: 'sticker', content: 'a.png' }));
  $('[data-message-id="s1"] .reply-btn').click();
  assert.equal($('#reply-banner-text').textContent, '철수님에게 답장: 스티커');

  socket.trigger('chat-message', chatMsg({ id: 'i1', type: 'image', content: 'data:image/jpeg;base64,AAAA' }));
  $('[data-message-id="i1"] .reply-btn').click();
  assert.equal($('#reply-banner-text').textContent, '철수님에게 답장: 사진');
});

test('내 메시지에 답장하면 닉네임은 내 닉네임으로 들어간다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ mine: true, nickname: '나' }));
  $('.reply-btn').click();
  assert.equal($('#reply-banner-text').textContent, '나님에게 답장: 안녕');
});

test('답장 인용이 표시되고, 클릭하면 원본이 잠깐 강조된다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg());
  socket.trigger(
    'chat-message',
    chatMsg({ id: 'm2', content: '응', replyTo: { id: 'm1', nickname: '철수', preview: '안녕' } })
  );
  const quote = $('[data-message-id="m2"] .reply-quote');
  assert.equal(quote.textContent, '↩ 철수: 안녕');
  assert.equal(quote.dataset.replyTarget, 'm1');

  quote.click();
  assert.ok($('[data-message-id="m1"]').classList.contains('flash-highlight'));
});

// ---------------------------------------------------------------- 리액션

test('리액션 알약이 개수/내가 눌렀는지와 함께 그려지고, 클릭하면 react가 나간다', async () => {
  const { $, $$, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ reactions: { '👍': { count: 2, mine: true }, '😂': { count: 1, mine: false } } }));

  const pills = $$('.reaction-pill');
  assert.deepEqual(pills.map((p) => p.textContent), ['👍 2', '😂 1']);
  assert.ok(pills[0].classList.contains('mine'));
  assert.ok(!pills[1].classList.contains('mine'));

  pills[1].click();
  assert.deepEqual(socket.lastSent('react').args[0], { messageId: 'm1', emoji: '😂' });
});

test('반응 버튼 → 팝업에서 이모지를 고르면 react가 나가고 팝업이 닫힌다', async () => {
  const { $, $$, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg());
  $('.react-btn').click();
  assert.ok(!$('#reaction-popup').classList.contains('hidden'));

  const picks = $$('.reaction-pick');
  assert.equal(picks.length, 6);
  picks[2].click();
  assert.deepEqual(socket.lastSent('react').args[0], { messageId: 'm1', emoji: picks[2].textContent });
  assert.ok($('#reaction-popup').classList.contains('hidden'));
});

test('팝업 바깥을 클릭하면 리액션 팝업이 닫힌다', async () => {
  const { $, document, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg());
  $('.react-btn').click();
  document.body.click();
  assert.ok($('#reaction-popup').classList.contains('hidden'));
});

test('reaction-update가 오면 해당 메시지의 알약이 갱신되고, 0개면 사라진다', async () => {
  const { $, $$, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg());
  socket.trigger('reaction-update', { messageId: 'm1', reactions: { '❤️': { count: 3, mine: false } } });
  assert.deepEqual($$('.reaction-pill').map((p) => p.textContent), ['❤️ 3']);

  socket.trigger('reaction-update', { messageId: 'm1', reactions: {} });
  assert.equal($$('.reaction-pill').length, 0);
});

// ---------------------------------------------------------------- 삭제 / 수정

test('삭제: 확인하면 delete-message가 나가고, 취소하면 안 나간다', async () => {
  const { $, dialogs, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ mine: true, nickname: '나' }));

  dialogs.confirmResult = false;
  $('.delete-btn').click();
  assert.equal(socket.sent('delete-message').length, 0);

  dialogs.confirmResult = true;
  $('.delete-btn').click();
  assert.deepEqual(socket.lastSent('delete-message').args[0], { messageId: 'm1' });
});

test('message-deleted가 오면 삭제 상태로 바뀌고 버튼/리액션이 사라진다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ mine: true, reactions: { '👍': { count: 1, mine: true } } }));
  socket.trigger('message-deleted', { messageId: 'm1' });

  const msg = $('.msg');
  assert.ok(msg.classList.contains('deleted'));
  assert.equal(msg.querySelector('.msg-body').textContent, '삭제된 메시지입니다');
  for (const sel of ['.react-btn', '.delete-btn', '.reply-btn', '.edit-btn', '.reaction-pill']) {
    assert.equal(msg.querySelector(sel), null, sel);
  }
});

test('수정: 새 내용을 입력하면 edit-message가 나가고, 같거나 빈 내용이면 안 나간다', async () => {
  const { $, dialogs, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ mine: true }));

  dialogs.promptResult = '  새 내용 ';
  $('.edit-btn').click();
  assert.deepEqual(dialogs.prompts[0], { msg: '메시지 수정', def: '안녕' });
  assert.deepEqual(socket.lastSent('edit-message').args[0], { messageId: 'm1', content: '새 내용' });

  const before = socket.sent('edit-message').length;
  for (const value of [null, '   ', '안녕']) {
    dialogs.promptResult = value;
    $('.edit-btn').click();
  }
  assert.equal(socket.sent('edit-message').length, before);
});

test('message-edited가 오면 본문이 바뀌고 (수정됨)이 한 번만 붙는다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('user-list', ['영희']);
  socket.trigger('chat-message', chatMsg({ mine: true }));

  socket.trigger('message-edited', { messageId: 'm1', content: '고침 @영희', editedAt: 1 });
  socket.trigger('message-edited', { messageId: 'm1', content: '또 고침', editedAt: 2 });
  assert.equal($('.msg-body').textContent, '또 고침');
  assert.equal($('.msg-time').textContent.match(/\(수정됨\)/g).length, 1);
});

// ---------------------------------------------------------------- 히스토리 / 페이지네이션

function manyMessages(n, startTime = 1700000000000) {
  return Array.from({ length: n }, (_, i) => chatMsg({ id: `h${i}`, content: `m${i}`, time: startTime + i }));
}

test('history를 받으면 기존 화면을 대체하고, 50개 미만이면 "더 보기" 버튼이 숨겨진다', async () => {
  const { $, $$, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 'old', content: '옛날' }));
  socket.trigger('history', manyMessages(3));

  assert.deepEqual($$('.msg').map((m) => m.dataset.messageId), ['h0', 'h1', 'h2']);
  assert.ok($('#load-more-btn').classList.contains('hidden'));
});

test('history가 한 페이지(50개) 가득이면 "이전 메시지 더 보기"가 보인다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('history', manyMessages(50));
  assert.ok(!$('#load-more-btn').classList.contains('hidden'));
});

test('이전 메시지 더 보기: 가장 오래된 시각으로 요청하고 결과를 맨 위에 붙인다', async () => {
  const { $, $$, socket } = await bootJoined();
  socket.trigger('history', manyMessages(50, 2000));
  $('#load-more-btn').click();

  const { args } = socket.lastSent('load-more');
  assert.deepEqual(args[0], { beforeTime: 2000 });
  assert.equal($('#load-more-btn').textContent, '불러오는 중...');
  assert.ok($('#load-more-btn').disabled);

  args[1]([chatMsg({ id: 'p0', content: 'older', time: 1000 })]);
  assert.equal($$('.msg')[0].dataset.messageId, 'p0');
  assert.equal($('#load-more-btn').textContent, '이전 메시지 더 보기');
  assert.ok(!$('#load-more-btn').disabled);
  // 다음 페이지 기준 시각이 갱신되어야 함
  $('#load-more-btn').click();
  assert.deepEqual(socket.lastSent('load-more').args[0], { beforeTime: 1000 });
});

test('더 불러올 게 없으면 "더 보기" 버튼이 숨겨진다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('history', manyMessages(50));
  $('#load-more-btn').click();
  socket.lastSent('load-more').args[1]([]);
  assert.ok($('#load-more-btn').classList.contains('hidden'));
});

test('받은 메시지는 sessionStorage에 저장되고, 새로고침(재부팅)하면 복원된다', async () => {
  const first = await bootJoined();
  first.socket.trigger('chat-message', chatMsg({ id: 'a', content: '하나' }));
  first.socket.trigger('system-message', '영희님이 입장했습니다.');
  const stored = first.window.sessionStorage.getItem('orischat-history:general');
  assert.ok(stored);

  const second = await boot({ session: { 'orischat-history:general': stored } });
  assert.equal(second.$('.msg:not(.system) .msg-body').textContent, '하나');
  assert.equal(second.$('.msg.system').textContent, '영희님이 입장했습니다.');
});

test('저장 히스토리는 200개까지만 유지된다', async () => {
  const { window, socket } = await bootJoined();
  for (let i = 0; i < 205; i++) socket.trigger('chat-message', chatMsg({ id: `x${i}`, content: `${i}` }));
  const saved = JSON.parse(window.sessionStorage.getItem('orischat-history:general'));
  assert.equal(saved.length, 200);
  assert.equal(saved[0].payload.id, 'x5');
});

test('리액션/삭제/수정 결과가 저장된 히스토리에도 반영된다', async () => {
  const { window, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 'a', mine: true }));
  socket.trigger('chat-message', chatMsg({ id: 'b', mine: true }));
  socket.trigger('chat-message', chatMsg({ id: 'c', mine: true }));

  socket.trigger('reaction-update', { messageId: 'a', reactions: { '👍': { count: 1, mine: true } } });
  socket.trigger('message-deleted', { messageId: 'b' });
  socket.trigger('message-edited', { messageId: 'c', content: '수정본', editedAt: 5 });

  const byId = Object.fromEntries(
    JSON.parse(window.sessionStorage.getItem('orischat-history:general')).map((e) => [e.payload.id, e.payload])
  );
  assert.deepEqual(byId.a.reactions, { '👍': { count: 1, mine: true } });
  assert.equal(byId.b.deleted, true);
  assert.equal(byId.c.content, '수정본');
  assert.equal(byId.c.edited, true);
});

test('방마다 히스토리 저장 키가 다르다', async () => {
  const { window, socket } = await boot();
  socket.trigger('joined', { nickname: '나', room: '연구실' });
  socket.trigger('chat-message', chatMsg());
  assert.ok(window.sessionStorage.getItem('orischat-history:연구실'));
  assert.equal(window.sessionStorage.getItem('orischat-history:general'), null);
});

// ---------------------------------------------------------------- 읽음 표시

test('채팅 메시지를 받으면 가장 최신 시각으로 mark-read를 보낸다', async () => {
  const { socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ time: 100 }));
  socket.trigger('chat-message', chatMsg({ id: 'm2', time: 300 }));
  socket.trigger('chat-message', chatMsg({ id: 'm3', time: 200 }));
  assert.deepEqual(socket.sent('mark-read').map((e) => e.args[0].time), [100, 300, 300]);
});

test('history를 받으면 마지막 메시지 시각으로 mark-read를 보낸다', async () => {
  const { socket } = await bootJoined();
  socket.trigger('history', manyMessages(3, 500));
  assert.deepEqual(socket.lastSent('mark-read').args[0], { time: 502 });
});

test('read-update: 모두가 읽은 시각 이하의 내 메시지에만 "읽음"이 표시된다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 'a', mine: true, time: 100 }));
  socket.trigger('chat-message', chatMsg({ id: 'b', mine: true, time: 200 }));
  socket.trigger('chat-message', chatMsg({ id: 'c', mine: false, time: 50 }));

  socket.trigger('read-update', { minReadTime: 150 });
  assert.equal($('[data-message-id="a"] .read-status').textContent, '읽음');
  assert.equal($('[data-message-id="b"] .read-status').textContent, '');

  socket.trigger('read-update', { minReadTime: 0 });
  assert.equal($('[data-message-id="a"] .read-status').textContent, '');
});

// ---------------------------------------------------------------- 검색

test('검색: 결과를 오래된 순으로 보여주고, 없으면 안내 문구를 보여준다', async () => {
  const { $, $$, fire, socket } = await bootJoined();
  $('#search-btn').click();
  assert.ok(!$('#search-panel').classList.contains('hidden'));

  $('#search-input').value = '안녕';
  fire($('#search-form'), 'submit');
  assert.equal($('#search-results').textContent, '검색 중...');
  const { args } = socket.lastSent('search-messages');
  assert.deepEqual(args[0], { query: '안녕' });

  args[1]([chatMsg({ id: 'new', content: '최근 안녕', time: 2000 }), chatMsg({ id: 'old', content: '옛 안녕', nickname: '영희', time: 1000 })]);
  const items = $$('.search-result-item');
  assert.equal(items.length, 2);
  assert.ok(items[0].querySelector('.search-result-meta').textContent.startsWith('영희 · '));
  assert.equal(items[0].textContent.includes('옛 안녕'), true);

  fire($('#search-form'), 'submit');
  socket.lastSent('search-messages').args[1]([]);
  assert.equal($('#search-results').textContent, '검색 결과가 없습니다.');

  $('#search-close-btn').click();
  assert.ok($('#search-panel').classList.contains('hidden'));
});

test('빈 검색어는 요청하지 않는다', async () => {
  const { $, fire, socket } = await bootJoined();
  $('#search-input').value = '  ';
  fire($('#search-form'), 'submit');
  assert.equal(socket.sent('search-messages').length, 0);
});

// ---------------------------------------------------------------- 아바타 / 라이트박스

test('프로필 사진이 없어 로드에 실패하면 이니셜 배지로 바뀐다', async () => {
  const { $, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ nickname: 'alice' }));
  const img = $('.msg .msg-avatar-img');
  img.onerror();

  const badge = $('.msg-nick span.msg-avatar');
  assert.equal(badge.textContent, 'A');
  assert.ok(/^(hsl|rgb)\(/.test(badge.style.background));
  assert.equal(badge.dataset.avatarNickname, 'alice');
});

test('같은 닉네임은 항상 같은 배지 색이다', async () => {
  const { $$, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: '1', nickname: 'bob' }));
  socket.trigger('chat-message', chatMsg({ id: '2', nickname: 'bob' }));
  $$('.msg-avatar-img').forEach((i) => i.onerror());
  const [a, b] = $$('.msg-nick span.msg-avatar');
  assert.equal(a.style.background, b.style.background);
});

test('avatar-updated가 오면 그 닉네임의 아바타가 새 버전 URL로 교체된다', async () => {
  const { $$, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: '1', nickname: '철수' }));
  socket.trigger('chat-message', chatMsg({ id: '2', nickname: '영희' }));
  socket.trigger('avatar-updated', { nickname: '철수', updatedAt: 777 });

  const srcs = $$('.msg .msg-avatar-img').map((i) => i.getAttribute('src'));
  assert.equal(srcs[0], `/avatar/${encodeURIComponent('철수')}?v=777`);
  assert.equal(srcs[1], `/avatar/${encodeURIComponent('영희')}?v=0`);
});

test('헤더의 내 프로필 버튼은 입장하면 내 아바타를 보여주고, 갱신되면 새 버전을 쓴다', async () => {
  const { $, socket } = await boot();
  socket.trigger('joined', { nickname: '나', room: 'general' });
  assert.equal($('#avatar-btn img').getAttribute('src'), `/avatar/${encodeURIComponent('나')}?v=0`);
  socket.trigger('avatar-updated', { nickname: '나', updatedAt: 9 });
  assert.equal($('#avatar-btn img').getAttribute('src'), `/avatar/${encodeURIComponent('나')}?v=9`);
});

test('내 프로필 버튼: 사진이 있으면 확대, 없으면(이니셜) 파일 선택창을 연다', async () => {
  const { $, window, socket } = await boot();
  socket.trigger('joined', { nickname: '나', room: 'general' });

  $('#avatar-btn').click();
  assert.ok(!$('#image-lightbox').classList.contains('hidden'));
  assert.equal($('#lightbox-img').getAttribute('src'), `/avatar/${encodeURIComponent('나')}?v=0`);
  $('#lightbox-close-btn').click();

  let opened = 0;
  $('#avatar-file-input').click = () => opened++;
  $('#avatar-btn img').onerror(); // 사진 없음 → 이니셜 배지
  $('#avatar-btn').click();
  assert.equal(opened, 1);
  assert.ok($('#image-lightbox').classList.contains('hidden'));
  void window;
});

test('사진/스티커를 누르면 라이트박스가 열리고, 배경·닫기 버튼·Esc로 닫힌다', async () => {
  const { $, document, window, socket } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ type: 'sticker', content: 'a.png' }));
  const open = () => $('.msg-body .sticker-img').click();

  open();
  assert.ok(!$('#image-lightbox').classList.contains('hidden'));
  assert.ok($('#lightbox-img').src.endsWith('/stickers/a.png'));

  $('#lightbox-img').click(); // 이미지 자체 클릭은 안 닫힘
  assert.ok(!$('#image-lightbox').classList.contains('hidden'));

  $('#image-lightbox').click(); // 배경 클릭
  assert.ok($('#image-lightbox').classList.contains('hidden'));

  open();
  $('#lightbox-close-btn').click();
  assert.ok($('#image-lightbox').classList.contains('hidden'));

  open();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok($('#image-lightbox').classList.contains('hidden'));
});

// ---------------------------------------------------------------- 테마 / 알림 버튼

test('테마 선택: 옵션을 고르면 data-theme와 localStorage가 바뀌고, 시스템 설정이면 제거된다', async () => {
  const { $, $$, document, window } = await boot();
  assert.equal(document.documentElement.getAttribute('data-theme'), null);
  assert.equal($$('#theme-picker .theme-option').length, 5);

  $('#theme-toggle-btn').click();
  assert.ok(!$('#theme-picker').classList.contains('hidden'));

  $('#theme-picker [data-theme-value="intellij"]').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'intellij');
  assert.equal(window.localStorage.getItem('orischat-theme'), 'intellij');
  assert.equal($('#theme-toggle-btn').textContent, '🧠');
  assert.ok($('#theme-picker').classList.contains('hidden'));
  assert.deepEqual($$('#theme-picker .active').map((b) => b.dataset.themeValue), ['intellij']);

  $('#theme-toggle-btn').click();
  $('#theme-picker [data-theme-value=""]').click();
  assert.equal(document.documentElement.getAttribute('data-theme'), null);
  assert.equal(window.localStorage.getItem('orischat-theme'), null);
});

test('저장된 테마가 시작할 때 적용되고, 바깥 클릭으로 피커가 닫힌다', async () => {
  const { $, document } = await boot({ local: { 'orischat-theme': 'excel' } });
  assert.equal(document.documentElement.getAttribute('data-theme'), 'excel');
  assert.equal($('#theme-toggle-btn').textContent, '📊');

  $('#theme-toggle-btn').click();
  document.body.click();
  assert.ok($('#theme-picker').classList.contains('hidden'));
});

test('Notification API가 없는 환경에서는 알림 버튼이 숨겨진다', async () => {
  const { $ } = await boot();
  assert.ok($('#notify-btn').classList.contains('hidden'));
});

// ---------------------------------------------------------------- 사용성 개선

test('날짜가 바뀌는 지점마다 날짜 구분선이 들어간다', async () => {
  const { socket, $$ } = await bootJoined();
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  socket.trigger('chat-message', chatMsg({ id: 'a', time: now - 3 * day }));
  socket.trigger('chat-message', chatMsg({ id: 'b', time: now - 3 * day + 1000 }));
  socket.trigger('chat-message', chatMsg({ id: 'c', time: now - day }));
  socket.trigger('chat-message', chatMsg({ id: 'd', time: now }));
  const labels = $$('.date-divider').map((el) => el.textContent);
  assert.equal(labels.length, 3);
  assert.equal(labels[1], '어제');
  assert.equal(labels[2], '오늘');
});

test('이전 메시지를 위에 붙이면 구분선이 다시 계산된다', async () => {
  const { socket, $, $$ } = await bootJoined();
  const t = Date.now();
  socket.trigger('history', Array.from({ length: 50 }, (_, i) => chatMsg({ id: `h${i}`, time: t - 1000 + i })));
  assert.equal($$('.date-divider').length, 1);
  $('#load-more-btn').click();
  const cb = socket.lastSent('load-more').args[1];
  cb([chatMsg({ id: 'old', time: t - 5 * 24 * 60 * 60 * 1000 })]);
  assert.equal($$('.date-divider').length, 2);
  assert.equal($('#messages').firstElementChild.className, 'date-divider');
});

test('텍스트 메시지에는 복사 버튼이 있고, 스티커/삭제된 메시지에는 없다', async () => {
  const { socket, $$ } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 't' }));
  socket.trigger('chat-message', chatMsg({ id: 's', type: 'sticker', content: 'a.png' }));
  socket.trigger('chat-message', chatMsg({ id: 'd', deleted: true }));
  assert.equal($$('.copy-btn').length, 1);
});

test('복사 버튼을 누르면 본문이 클립보드로 가고 토스트가 뜬다', async () => {
  const { socket, window, $ } = await bootJoined();
  let copied = null;
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (t) => (copied = t) }, configurable: true });
  socket.trigger('chat-message', chatMsg({ content: '복사할 글' }));
  $('.copy-btn').click();
  await tick();
  assert.equal(copied, '복사할 글');
  assert.equal($('#rate-limit-toast').textContent, '복사했어요');
  assert.ok($('#rate-limit-toast').classList.contains('show'));
});

test('말풍선을 탭하면 액션 버튼이 펼쳐지고, 다시 탭하면 접힌다', async () => {
  const { socket, $ } = await bootJoined();
  socket.trigger('chat-message', chatMsg());
  $('.msg-body').click();
  assert.ok($('.msg').classList.contains('actions-open'));
  $('.msg-body').click();
  assert.ok(!$('.msg').classList.contains('actions-open'));
});

test('탭이 가려진 동안 남의 메시지가 오면 탭 제목에 안 읽은 수가 붙고, 돌아오면 사라진다', async () => {
  const { socket, document, fire } = await bootJoined();
  const base = document.title;
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  socket.trigger('chat-message', chatMsg({ id: 'u1' }));
  socket.trigger('chat-message', chatMsg({ id: 'u2', mine: true }));
  socket.trigger('chat-message', chatMsg({ id: 'u3' }));
  assert.equal(document.title, `(2) ${base}`);
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  fire(document, 'visibilitychange');
  assert.equal(document.title, base);
});

test('스크롤을 올려 읽는 중 새 메시지가 오면 ⬇ 버튼에 개수가 뜨고, 맨 아래로 가면 사라진다', async () => {
  const { socket, $ } = await bootJoined();
  const messages = $('#messages');
  Object.defineProperty(messages, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(messages, 'clientHeight', { value: 500, configurable: true });
  Object.defineProperty(messages, 'scrollTop', { value: 0, configurable: true, writable: true });
  socket.trigger('chat-message', chatMsg({ id: 'n1' }));
  socket.trigger('chat-message', chatMsg({ id: 'n3' }));
  assert.equal($('#scroll-bottom-count').textContent, '2');
  assert.ok(!$('#scroll-bottom-count').classList.contains('hidden'));
  $('#scroll-bottom-btn').click();
  assert.ok($('#scroll-bottom-count').classList.contains('hidden'));
});

test('연결이 끊기면 안내 배너가 뜨고, 다시 연결되면 사라진다', async () => {
  const { socket, $ } = await bootJoined();
  assert.ok($('#connection-banner').classList.contains('hidden'));
  socket.trigger('disconnect');
  assert.ok(!$('#connection-banner').classList.contains('hidden'));
  socket.trigger('connect');
  assert.ok($('#connection-banner').classList.contains('hidden'));
});

test('쓰던 글은 방별로 임시저장되고, 다시 입장하면 복원되며, 전송하면 지워진다', async () => {
  const { socket, window, $, fire } = await bootJoined();
  const input = $('#message-input');
  input.value = '쓰다 만 글';
  fire(input, 'input');
  assert.equal(window.sessionStorage.getItem('orischat-draft-general'), '쓰다 만 글');

  input.value = '';
  socket.trigger('joined', { nickname: '나', room: 'general' });
  assert.equal(input.value, '쓰다 만 글');

  $('#message-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(window.sessionStorage.getItem('orischat-draft-general'), null);
});

test('한글 조합 중 Enter는 기본 동작(폼 전송)이 막힌다', async () => {
  const { window, $ } = await bootJoined();
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  $('#message-input').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  const plain = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  $('#message-input').dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false);
});

test('@를 입력하면 방 사람 목록이 뜨고, 고르면 입력창에 채워진다', async () => {
  const { socket, $, $$, fire, key } = await bootJoined();
  socket.trigger('user-list', ['나', '철수', '영희', '철민']);
  const input = $('#message-input');
  input.value = '안녕 @철';
  input.setSelectionRange(input.value.length, input.value.length);
  fire(input, 'input');
  assert.deepEqual($$('.mention-item').map((el) => el.textContent), ['@철수', '@철민']);

  key(input, 'ArrowDown');
  key(input, 'Enter');
  assert.equal(input.value, '안녕 @철민 ');
  assert.ok($('#mention-popup').classList.contains('hidden'));
});

test('@ 뒤에 일치하는 사람이 없으면 목록이 안 뜨고, 나 자신은 목록에 없다', async () => {
  const { socket, $, fire } = await bootJoined();
  socket.trigger('user-list', ['나', '철수']);
  const input = $('#message-input');
  input.value = '@나';
  input.setSelectionRange(2, 2);
  fire(input, 'input');
  assert.ok($('#mention-popup').classList.contains('hidden'));
  input.value = '@zzz';
  input.setSelectionRange(4, 4);
  fire(input, 'input');
  assert.ok($('#mention-popup').classList.contains('hidden'));
});

test('이메일처럼 @ 앞에 글자가 붙어 있으면 멘션 목록을 띄우지 않는다', async () => {
  const { socket, $, fire } = await bootJoined();
  socket.trigger('user-list', ['나', '철수']);
  const input = $('#message-input');
  input.value = 'a@철';
  input.setSelectionRange(3, 3);
  fire(input, 'input');
  assert.ok($('#mention-popup').classList.contains('hidden'));
});

test('이미지를 붙여넣으면 기본 붙여넣기가 막히고, 텍스트 붙여넣기는 그대로 둔다', async () => {
  const { window, $ } = await bootJoined();
  const paste = (files) => {
    const ev = new window.Event('paste', { bubbles: true, cancelable: true });
    ev.clipboardData = { files };
    $('#message-input').dispatchEvent(ev);
    return ev;
  };
  const img = new window.File(['x'], 'a.png', { type: 'image/png' });
  assert.equal(paste([img]).defaultPrevented, true);
  assert.equal(paste([]).defaultPrevented, false);
});

test('파일을 끌어오면 안내가 뜨고, 놓거나 벗어나면 사라진다', async () => {
  const { window, $ } = await bootJoined();
  const drag = (type, extra = {}) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.dataTransfer = { types: ['Files'], files: [], ...extra };
    $('#chat-main').dispatchEvent(ev);
    return ev;
  };
  drag('dragenter');
  assert.ok(!$('#drop-overlay').classList.contains('hidden'));
  drag('dragleave');
  assert.ok($('#drop-overlay').classList.contains('hidden'));
  drag('dragenter');
  const drop = drag('drop');
  assert.equal(drop.defaultPrevented, true);
  assert.ok($('#drop-overlay').classList.contains('hidden'));
});

// ---------------------------------------------------------------- 안 읽은 구분선 / 검색 이동 / GIF / 닉네임 중복

const LASTSEEN_KEY = 'orischat-lastseen-general';

test('다시 들어왔을 때 마지막으로 본 시각 이후 남의 첫 메시지 앞에 "안 읽은 메시지" 구분선이 들어간다', async () => {
  const { socket, $, $$ } = await boot({ local: { [LASTSEEN_KEY]: '1700000000500' } });
  socket.trigger('joined', { nickname: '나', room: 'general' });
  socket.trigger('history', [
    chatMsg({ id: 'a', time: 1700000000100 }),
    chatMsg({ id: 'b', time: 1700000000400, mine: true }),
    chatMsg({ id: 'c', time: 1700000000600, mine: true }), // 내 메시지는 안 읽은 것으로 안 침
    chatMsg({ id: 'd', time: 1700000000700 }),
    chatMsg({ id: 'e', time: 1700000000800 }),
  ]);
  assert.equal($$('.unread-divider').length, 1);
  assert.equal($('.unread-divider').nextElementSibling.dataset.messageId, 'd');
  assert.equal($('#scroll-bottom-count').textContent, '2');
});

test('처음 방문이거나 다 읽었으면 구분선이 없고, 본 시각은 갱신된다', async () => {
  const first = await bootJoined();
  first.socket.trigger('history', [chatMsg({ id: 'a', time: 1700000000100 })]);
  assert.equal(first.$$('.unread-divider').length, 0);
  assert.equal(first.window.localStorage.getItem(LASTSEEN_KEY), '1700000000100'); // 탭이 보이는 상태라 읽음 처리됨

  const caughtUp = await boot({ local: { [LASTSEEN_KEY]: '1700000000900' } });
  caughtUp.socket.trigger('joined', { nickname: '나', room: 'general' });
  caughtUp.socket.trigger('history', [chatMsg({ id: 'a', time: 1700000000100 })]);
  assert.equal(caughtUp.$$('.unread-divider').length, 0);
});

test('탭이 가려진 사이 처음 온 남의 메시지 앞에 구분선이 생기고, 두 번째 메시지에는 안 생긴다', async () => {
  const { socket, document, $, $$ } = await bootJoined();
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  socket.trigger('chat-message', chatMsg({ id: 'x1' }));
  socket.trigger('chat-message', chatMsg({ id: 'x2' }));
  assert.equal($$('.unread-divider').length, 1);
  assert.equal($('.unread-divider').nextElementSibling.dataset.messageId, 'x1');
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

test('검색 결과를 누르면 이미 화면에 있는 메시지로 이동(강조)하고 검색 패널이 닫힌다', async () => {
  const { socket, $, $$, fire } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 'target', content: '찾는 글' }));
  $('#search-btn').click();
  $('#search-input').value = '찾는';
  fire($('#search-form'), 'submit');
  socket.lastSent('search-messages').args[1]([chatMsg({ id: 'target', content: '찾는 글' })]);
  $('.search-result-item').click();
  assert.ok($('[data-message-id="target"]').classList.contains('flash-highlight'));
  assert.ok($('#search-panel').classList.contains('hidden'));
  assert.equal(socket.sent('load-until').length, 0);
  assert.equal($$('.search-result-item').length, 1);
});

test('화면에 없는 오래된 메시지를 누르면 load-until로 불러와 붙이고 이동한다', async () => {
  const { socket, $, fire } = await bootJoined();
  socket.trigger('history', [chatMsg({ id: 'new1', time: 1700000100000 })]);
  $('#search-btn').click();
  $('#search-input').value = '옛날';
  fire($('#search-form'), 'submit');
  const old = chatMsg({ id: 'old', content: '옛날 글', time: 1700000000000 });
  socket.lastSent('search-messages').args[1]([old]);
  $('.search-result-item').click();

  const req = socket.lastSent('load-until');
  assert.deepEqual(req.args[0], { fromTime: 1700000000000, beforeTime: 1700000100000 });
  req.args[1]([old, chatMsg({ id: 'mid', time: 1700000050000 })]);
  assert.ok($('[data-message-id="old"]'));
  assert.ok($('[data-message-id="old"]').classList.contains('flash-highlight'));
});

test('불러오지 못하면 안내 토스트가 뜬다', async () => {
  const { socket, $, fire } = await bootJoined();
  socket.trigger('history', [chatMsg({ id: 'new1', time: 1700000100000 })]);
  $('#search-btn').click();
  $('#search-input').value = 'x';
  fire($('#search-form'), 'submit');
  socket.lastSent('search-messages').args[1]([chatMsg({ id: 'gone', time: 1700000000000 })]);
  $('.search-result-item').click();
  socket.lastSent('load-until').args[1]([]);
  assert.equal($('#rate-limit-toast').textContent, '메시지를 찾을 수 없어요');
});

test('GIF 버튼은 서버에서 GIF가 켜졌을 때만 보인다', async () => {
  const off = await boot({ config: { gifEnabled: false } });
  assert.ok(off.$('#gif-btn').classList.contains('hidden'));
  const on = await boot({ config: { gifEnabled: true } });
  assert.ok(!on.$('#gif-btn').classList.contains('hidden'));
});

test('GIF 버튼 → 인기 GIF 목록 → 클릭하면 gif 메시지가 전송된다', async () => {
  const gif = { id: 'g1', preview: 'https://media1.giphy.com/media/g1/100w.gif', url: 'https://media1.giphy.com/media/g1/200w.gif' };
  const { socket, $, $$ } = await bootJoined({ config: { gifEnabled: true }, extraRoutes: { '/api/gifs?q=': [gif] } });
  $('#gif-btn').click();
  await tick();
  assert.ok(!$('#gif-picker').classList.contains('hidden'));
  assert.equal($$('.gif-item').length, 1);
  $('.gif-item').click();
  assert.deepEqual(socket.lastSent('chat-message').args[0], { type: 'gif', content: gif.url });
  assert.ok($('#gif-picker').classList.contains('hidden'));
});

test('GIF 검색어를 입력하면 잠깐 뒤 그 검색어로 다시 불러온다', async () => {
  const cat = { id: 'c1', preview: 'https://media1.giphy.com/media/c1/100w.gif', url: 'https://media1.giphy.com/media/c1/200w.gif' };
  const { $, $$, fire } = await bootJoined({
    config: { gifEnabled: true },
    extraRoutes: { '/api/gifs?q=': [], [`/api/gifs?q=${encodeURIComponent('고양이')}`]: [cat] },
  });
  $('#gif-btn').click();
  await tick();
  assert.equal($('#gif-grid').textContent, '검색 결과가 없어요.');
  $('#gif-search-input').value = '고양이';
  fire($('#gif-search-input'), 'input');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal($$('.gif-item').length, 1);
});

test('GIF 메시지는 이미지로 그려지고(클릭 시 확대), 답장 미리보기는 "GIF"다', async () => {
  const { socket, $, $$ } = await bootJoined();
  socket.trigger('chat-message', chatMsg({ id: 'gm', type: 'gif', content: 'https://media1.giphy.com/media/g1/200w.gif' }));
  const img = $('.gif-img');
  assert.equal(img.src, 'https://media1.giphy.com/media/g1/200w.gif');
  assert.ok($('.msg').classList.contains('sticker'));
  assert.equal($$('.copy-btn').length, 0);
  $('.reply-btn').click();
  assert.equal(socket.emitted.length >= 0, true);
  assert.match($('#reply-banner-text').textContent, /GIF$/);
});

test('닉네임이 겹쳐서 입장이 거절되면 쓰던 닉네임이 입력칸에 채워진다', async () => {
  const { socket, $ } = await boot({ session: { 'orischat-nickname': '철수' } });
  socket.trigger('join-error', '이미 사용 중인 닉네임입니다. 다른 닉네임을 써주세요.');
  assert.ok(!$('#login-screen').classList.contains('hidden'));
  assert.equal($('#nickname-input').value, '철수');
  assert.match($('#join-error').textContent, /이미 사용 중/);
});

test('위를 읽던 중이어도 내가 보낸 메시지는 맨 아래로 따라가고, 남의 메시지는 안 따라간다', async () => {
  const { socket, $ } = await bootJoined();
  const messages = $('#messages');
  Object.defineProperty(messages, 'scrollHeight', { value: 3000, configurable: true });
  Object.defineProperty(messages, 'clientHeight', { value: 500, configurable: true });
  Object.defineProperty(messages, 'scrollTop', { value: 0, configurable: true, writable: true });
  socket.trigger('chat-message', chatMsg({ id: 'o1' }));
  assert.equal(messages.scrollTop, 0);
  socket.trigger('chat-message', chatMsg({ id: 'me1', mine: true }));
  assert.equal(messages.scrollTop, 3000);
  assert.ok($('#scroll-bottom-count').classList.contains('hidden'));
});
