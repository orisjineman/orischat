const socket = io();

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const nicknameInput = document.getElementById('nickname-input');
const roomInput = document.getElementById('room-input');
const pinInput = document.getElementById('pin-input');
const joinError = document.getElementById('join-error');
const joinBtn = document.getElementById('join-btn');
const userList = document.getElementById('user-list');
const messagesEl = document.getElementById('messages');
const typingIndicator = document.getElementById('typing-indicator');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const notifyBtn = document.getElementById('notify-btn');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const roomLabel = document.getElementById('room-label');

const DEFAULT_ROOM = 'general';
const HISTORY_PAGE_SIZE = 50;

// 브라우저마다 고유한 ID. 재연결(화면 꺼짐/네트워크 전환 등)되어도 "내 메시지"를
// 정확히 구분하기 위해 서버에만 알려주는 값 (다른 사용자에게는 절대 전달되지 않음).
function getClientId() {
  let id = localStorage.getItem('orischat-client-id');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('orischat-client-id', id);
  }
  return id;
}
const myClientId = getClientId();

// sessionStorage는 "새로고침하면 유지되고, 탭을 닫으면 사라지는" 저장소라서
// 딱 원하는 동작(새로고침 → 재입장 화면 안 보고 이어가기 / 탭 닫음 → 초기화)에 맞음.
const NICKNAME_KEY = 'orischat-nickname';
const PIN_KEY = 'orischat-pin';
const ROOM_KEY = 'orischat-room';
const HISTORY_LIMIT = 200;

function roomFromUrl() {
  const params = new URLSearchParams(location.search);
  return (params.get('room') || '').trim().slice(0, 30) || null;
}

function historyKey() {
  return `orischat-history:${myRoom || DEFAULT_ROOM}`;
}

let myNickname = sessionStorage.getItem(NICKNAME_KEY) || '';
let myPin = sessionStorage.getItem(PIN_KEY) || '';
let myRoom = roomFromUrl() || sessionStorage.getItem(ROOM_KEY) || '';
let hasJoined = false;
let typingTimeout = null;
let oldestMessageTime = null;
let pushPublicKey = null;
let pushSubscribed = false;

if (roomFromUrl()) roomInput.value = roomFromUrl();

// 새로고침 시 로그인 화면이 잠깐이라도 보이지 않도록, 저장된 닉네임이 있으면
// 곧바로 채팅 화면을 보여주고 뒤에서 재입장을 시도함.
if (myNickname) {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
}

// 서버에 비밀번호가 설정되어 있을 때만 입력칸을 보여주고, 백그라운드 푸시 공개키를 받아둠
fetch('/api/config')
  .then((res) => res.json())
  .then(({ pinRequired, pushPublicKey: key }) => {
    if (pinRequired) pinInput.classList.remove('hidden');
    pushPublicKey = key || null;
    // 알림 권한이 이미 "허용"인 상태로 새로고침한 경우, 페이지 로드 시점의
    // updateNotifyButton() 호출은 이 fetch가 끝나기 전이라 pushPublicKey가 아직
    // 없어서 구독을 건너뛰었을 수 있음 — 키가 도착한 지금 다시 시도함.
    if (pushPublicKey && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      trySubscribePush();
    }
  })
  .catch(() => {});

function loadHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(historyKey()) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  while (history.length > HISTORY_LIMIT) history.shift();
  try {
    sessionStorage.setItem(historyKey(), JSON.stringify(history));
  } catch {
    // 저장 공간이 꽉 찬 경우 등은 무시 (히스토리 유지는 보너스 기능이라 실패해도 괜찮음)
  }
}

// 리액션이 바뀌면 sessionStorage에 저장해둔 히스토리에도 반영해서, 새로고침해도
// 리액션 상태가 유지되게 함
function updateHistoryReactions(messageId, reactionsObj) {
  const history = loadHistory();
  let changed = false;
  for (const entry of history) {
    if (entry.kind === 'chat' && entry.payload && entry.payload.id === messageId) {
      entry.payload.reactions = reactionsObj;
      changed = true;
    }
  }
  if (changed) {
    try {
      sessionStorage.setItem(historyKey(), JSON.stringify(history));
    } catch {
      // 무시
    }
  }
}

function markDeletedInHistory(messageId) {
  const history = loadHistory();
  let changed = false;
  for (const entry of history) {
    if (entry.kind === 'chat' && entry.payload && entry.payload.id === messageId) {
      entry.payload.deleted = true;
      changed = true;
    }
  }
  if (changed) {
    try {
      sessionStorage.setItem(historyKey(), JSON.stringify(history));
    } catch {
      // 무시
    }
  }
}

// --- 라이트 / 다크 테마 수동 토글 (시스템 설정보다 우선 적용됨) ---
const THEME_KEY = 'orischat-theme';
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggleBtn.textContent = theme === 'dark' ? '🌙' : '☀️';
  } else {
    document.documentElement.removeAttribute('data-theme');
    themeToggleBtn.textContent = '🌓';
  }
}
applyTheme(localStorage.getItem(THEME_KEY));

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  // 시스템 기본값 → 반대쪽으로 한 번, 다시 누르면 원래대로(시스템 설정 따름)로 순환
  let next;
  if (!current) next = systemDark ? 'light' : 'dark';
  else next = null;
  if (next) localStorage.setItem(THEME_KEY, next);
  else localStorage.removeItem(THEME_KEY);
  applyTheme(next);
});

// --- 백그라운드 푸시 알림 (탭/브라우저를 닫아도 알림 받기) ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

async function trySubscribePush() {
  if (!pushPublicKey || pushSubscribed) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
      });
    }
    socket.emit('push-subscribe', subscription.toJSON());
    pushSubscribed = true;
  } catch (err) {
    console.warn('푸시 구독 실패(포그라운드 알림만 동작):', err);
  }
}

function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(updateNotifyButton);
  }
}

// 알림 버튼 상태 표시. sessionStorage로 세션이 자동 복원되는 경우(재입장 버튼을
// 직접 안 누름)에는 권한 요청 기회가 없었을 수 있어서, 버튼을 눌러 언제든
// 다시 요청할 수 있게 함.
function updateNotifyButton() {
  if (typeof Notification === 'undefined') {
    notifyBtn.classList.add('hidden');
    return;
  }
  if (Notification.permission === 'granted') {
    notifyBtn.textContent = '🔔 알림 켜짐';
    notifyBtn.classList.add('granted');
    trySubscribePush();
  } else if (Notification.permission === 'denied') {
    notifyBtn.textContent = '🔕 알림 차단됨 (브라우저 설정에서 허용해주세요)';
    notifyBtn.classList.remove('granted');
  } else {
    notifyBtn.textContent = '🔕 알림 켜기';
    notifyBtn.classList.remove('granted');
  }
}

notifyBtn.addEventListener('click', () => {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(updateNotifyButton);
  } else {
    updateNotifyButton(); // denied/granted면 그냥 현재 상태 문구만 다시 보여줌(+granted면 푸시 재구독 시도)
  }
});

updateNotifyButton();

function updateRoomLabel(room) {
  roomLabel.textContent = room && room !== DEFAULT_ROOM ? `OrisChat · ${room}` : 'OrisChat';
}

function updateUrlForRoom(room) {
  const url = room && room !== DEFAULT_ROOM ? `${location.pathname}?room=${encodeURIComponent(room)}` : location.pathname;
  history.replaceState(null, '', url);
}

function join() {
  const name = nicknameInput.value.trim();
  if (!name) {
    nicknameInput.focus();
    return;
  }
  requestNotificationPermission(); // 버튼 클릭(사용자 제스처) 시점에 물어봐야 브라우저가 허용함
  myNickname = name;
  myPin = pinInput.value;
  myRoom = roomInput.value.trim().slice(0, 30);
  joinError.classList.add('hidden');
  socket.emit('join', { nickname: name, clientId: myClientId, pin: myPin, room: myRoom });
}

joinBtn.addEventListener('click', join);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

// 소켓이 (재)연결될 때마다 실행됨 — 페이지를 새로고침한 첫 연결이든, 네트워크가
// 끊겼다 다시 붙은 재연결이든 동일하게 저장된 닉네임/clientId/방으로 자동 (재)입장함.
socket.on('connect', () => {
  if (myNickname) {
    socket.emit('join', { nickname: myNickname, clientId: myClientId, pin: myPin, room: myRoom });
  }
});

socket.on('joined', ({ nickname, room }) => {
  const firstTime = !hasJoined;
  myNickname = nickname;
  myRoom = room;
  hasJoined = true;
  sessionStorage.setItem(NICKNAME_KEY, nickname);
  sessionStorage.setItem(PIN_KEY, myPin);
  sessionStorage.setItem(ROOM_KEY, room);
  updateRoomLabel(room);
  updateUrlForRoom(room);
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  if (firstTime) {
    messageInput.focus();
  }
});

socket.on('join-error', (msg) => {
  // 자동 재입장 시도가 실패한 경우(비밀번호가 바뀐 등)도 포함 — 다시 입력받아야 함
  hasJoined = false;
  sessionStorage.removeItem(NICKNAME_KEY);
  sessionStorage.removeItem(PIN_KEY);
  chatScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  joinError.textContent = msg;
  joinError.classList.remove('hidden');
});

socket.on('user-list', (users) => {
  userList.innerHTML = '';
  users.forEach((name) => {
    const li = document.createElement('li');
    li.textContent = name;
    userList.appendChild(li);
  });
});

// 짧은 시간에 너무 많이 보내면 서버가 알려줌 (스팸/도배 방지)
const rateLimitToast = document.createElement('div');
rateLimitToast.id = 'rate-limit-toast';
rateLimitToast.textContent = '너무 빨라요! 잠시 후 다시 시도해주세요.';
document.body.appendChild(rateLimitToast);
let rateLimitToastTimer = null;
socket.on('rate-limited', () => {
  rateLimitToast.classList.add('show');
  clearTimeout(rateLimitToastTimer);
  rateLimitToastTimer = setTimeout(() => rateLimitToast.classList.remove('show'), 2000);
});

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// 닉네임마다 고정된 색을 만들어줌 (아바타 배경색). 같은 닉네임이면 항상 같은 색.
function nicknameColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 60%, 45%)`;
}

function nicknameInitial(name) {
  const chars = Array.from(name || '?');
  return (chars[0] || '?').toUpperCase();
}

// 메시지 안의 http(s):// 링크를 클릭 가능한 <a>로 바꿔줌 (그 외 텍스트는 그대로 escape됨)
const URL_PATTERN = /(https?:\/\/[^\s]+)/;
function renderLinkedText(container, text) {
  container.textContent = '';
  text.split(URL_PATTERN).forEach((part) => {
    if (!part) return;
    if (/^https?:\/\//.test(part)) {
      const a = document.createElement('a');
      a.href = part;
      a.textContent = part;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      container.appendChild(a);
    } else {
      container.appendChild(document.createTextNode(part));
    }
  });
}

// --- 이모지 리액션 ---
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const reactionPopup = document.createElement('div');
reactionPopup.id = 'reaction-popup';
reactionPopup.className = 'hidden';
reactionPopup.innerHTML = QUICK_REACTIONS.map(
  (e) => `<button type="button" class="reaction-pick">${e}</button>`
).join('');
document.body.appendChild(reactionPopup);
let reactionPopupTarget = null;

// 서버가 보내주는 reactions 형식: { emoji: { count, mine } } — mine은 "나도 눌렀는지"
function renderReactions(container, reactionsObj) {
  container.innerHTML = '';
  Object.entries(reactionsObj || {}).forEach(([emoji, info]) => {
    if (!info || !info.count) return;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'reaction-pill' + (info.mine ? ' mine' : '');
    pill.dataset.emoji = emoji;
    pill.textContent = `${emoji} ${info.count}`;
    container.appendChild(pill);
  });
}

function sendReaction(messageId, emoji) {
  if (!messageId) return;
  socket.emit('react', { messageId, emoji });
}

function openReactionPopup(anchorEl, messageId) {
  reactionPopupTarget = messageId;
  reactionPopup.classList.remove('hidden');

  const rect = anchorEl.getBoundingClientRect();
  const popupWidth = reactionPopup.offsetWidth;
  // 화면 오른쪽/왼쪽 경계를 넘지 않도록 보정
  let left = rect.left + window.scrollX - popupWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));

  reactionPopup.style.top = `${rect.top + window.scrollY - 44}px`;
  reactionPopup.style.left = `${left}px`;
}

reactionPopup.addEventListener('click', (e) => {
  const btn = e.target.closest('.reaction-pick');
  if (btn && reactionPopupTarget) {
    sendReaction(reactionPopupTarget, btn.textContent);
  }
  reactionPopup.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!reactionPopup.classList.contains('hidden') && !reactionPopup.contains(e.target) && !e.target.closest('.react-btn')) {
    reactionPopup.classList.add('hidden');
  }
});

messagesEl.addEventListener('click', (e) => {
  const reactBtn = e.target.closest('.react-btn');
  if (reactBtn) {
    const msgEl = reactBtn.closest('.msg');
    openReactionPopup(reactBtn, msgEl.dataset.messageId);
    return;
  }

  const deleteBtn = e.target.closest('.delete-btn');
  if (deleteBtn) {
    const msgEl = deleteBtn.closest('.msg');
    if (msgEl && confirm('이 메시지를 삭제할까요?')) {
      socket.emit('delete-message', { messageId: msgEl.dataset.messageId });
    }
    return;
  }

  const pill = e.target.closest('.reaction-pill');
  if (pill) {
    const msgEl = pill.closest('.msg');
    sendReaction(msgEl.dataset.messageId, pill.dataset.emoji);
  }
});

socket.on('reaction-update', ({ messageId, reactions }) => {
  const msgEl = messagesEl.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (msgEl) {
    renderReactions(msgEl.querySelector('.msg-reactions'), reactions);
  }
  updateHistoryReactions(messageId, reactions);
});

socket.on('message-deleted', ({ messageId }) => {
  const msgEl = messagesEl.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
  if (msgEl) applyDeletedState(msgEl);
  markDeletedInHistory(messageId);
});

function applyDeletedState(msgEl) {
  msgEl.classList.add('deleted');
  const body = msgEl.querySelector('.msg-body');
  if (body) body.textContent = '삭제된 메시지입니다';
  const reactionsEl = msgEl.querySelector('.msg-reactions');
  if (reactionsEl) reactionsEl.innerHTML = '';
  const reactBtn = msgEl.querySelector('.react-btn');
  if (reactBtn) reactBtn.remove();
  const deleteBtn = msgEl.querySelector('.delete-btn');
  if (deleteBtn) deleteBtn.remove();
}

// --- 메시지 렌더링 ---
// payload: { id, type, content, nickname, time, mine, reactions, deleted }
function buildMessageEl({ id, type, content, message, nickname, time, mine, reactions, deleted }) {
  const div = document.createElement('div');
  // 구버전 서버 호환: type이 없으면 텍스트 메시지(message 필드)로 취급
  const kind = type || 'text';
  const text = content ?? message ?? '';

  div.className = `msg ${mine ? 'me' : 'other'} ${kind === 'sticker' ? 'sticker' : ''}`;
  if (id) div.dataset.messageId = id;

  const nickHtml = mine
    ? ''
    : `<div class="msg-nick"><span class="msg-avatar" style="background:${nicknameColor(nickname)}">${escapeHtml(
        nicknameInitial(nickname)
      )}</span>${escapeHtml(nickname)}</div>`;

  div.innerHTML = `
    ${nickHtml}
    <div class="msg-body"></div>
    <div class="msg-footer">
      <span class="msg-time">${formatTime(time)}</span>
      ${id && !deleted ? '<button type="button" class="react-btn" aria-label="반응 추가">🙂</button>' : ''}
      ${id && mine && !deleted ? '<button type="button" class="delete-btn" aria-label="삭제">🗑</button>' : ''}
    </div>
    <div class="msg-reactions"></div>
  `;

  const body = div.querySelector('.msg-body');
  if (deleted) {
    div.classList.add('deleted');
    body.textContent = '삭제된 메시지입니다';
  } else if (kind === 'sticker') {
    const img = document.createElement('img');
    img.src = `/stickers/${encodeURIComponent(text)}`;
    img.alt = '스티커';
    img.className = 'sticker-img';
    body.appendChild(img);
  } else {
    renderLinkedText(body, text);
  }

  if (reactions && !deleted) {
    renderReactions(div.querySelector('.msg-reactions'), reactions);
  }

  return div;
}

function appendMessage(payload) {
  const div = buildMessageEl(payload);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 탭이 안 보일 때 새 메시지가 오면 브라우저 알림을 띄움 (백그라운드 푸시가 안 될 때의 대체 수단)
function maybeNotify(payload) {
  if (pushSubscribed) return; // 푸시가 켜져 있으면 Service Worker가 알림을 담당함
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (payload.mine) return;
  if (!document.hidden) return;

  // 메시지 내용은 알림에 노출하지 않음 (잠금화면 등에서 다른 사람이 볼 수 있어서)
  try {
    const n = new Notification(`${payload.nickname || '누군가'}님이 메시지를 보냈습니다`, {
      body: '확인하려면 클릭하세요',
      tag: 'orischat-message',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // 알림 생성 실패는 무시 (필수 기능 아님)
  }
}

// --- 이전 메시지 더 보기(페이지네이션) ---
const loadMoreBtn = document.createElement('button');
loadMoreBtn.type = 'button';
loadMoreBtn.id = 'load-more-btn';
loadMoreBtn.textContent = '이전 메시지 더 보기';
loadMoreBtn.classList.add('hidden');
messagesEl.insertAdjacentElement('beforebegin', loadMoreBtn);

function prependMessages(list) {
  const prevHeight = messagesEl.scrollHeight;
  const prevTop = messagesEl.scrollTop;
  const frag = document.createDocumentFragment();
  list.forEach((payload) => frag.appendChild(buildMessageEl(payload)));
  messagesEl.insertBefore(frag, messagesEl.firstChild);
  messagesEl.scrollTop = prevTop + (messagesEl.scrollHeight - prevHeight);
}

loadMoreBtn.addEventListener('click', () => {
  if (!oldestMessageTime) return;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = '불러오는 중...';
  socket.emit('load-more', { beforeTime: oldestMessageTime }, (older) => {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = '이전 메시지 더 보기';
    if (!older || older.length === 0) {
      loadMoreBtn.classList.add('hidden');
      return;
    }
    prependMessages(older);
    oldestMessageTime = older[0].time;
    if (older.length < HISTORY_PAGE_SIZE) {
      loadMoreBtn.classList.add('hidden');
    }
  });
});

// 새로고침 시 sessionStorage에 저장해둔 이전 대화를 먼저 복원
loadHistory().forEach((entry) => {
  if (entry.kind === 'chat') appendMessage(entry.payload);
  else if (entry.kind === 'system') appendSystemMessage(entry.text);
});

socket.on('chat-message', (payload) => {
  appendMessage(payload);
  saveToHistory({ kind: 'chat', payload });
  maybeNotify(payload);
});

// 서버가 DB에서 불러온 진짜 대화 기록(최근 페이지 하나 분량). sessionStorage
// 캐시(새로고침 전까지의 임시 복원용)를 서버가 알려주는 정확한 내용으로 교체함
// — 이렇게 하면 새로 들어온 사람도 지난 대화를 볼 수 있고, 중복 표시도 안 생김.
socket.on('history', (messages) => {
  messagesEl.innerHTML = '';
  sessionStorage.removeItem(historyKey());
  messages.forEach((payload) => {
    appendMessage(payload);
    saveToHistory({ kind: 'chat', payload });
  });
  oldestMessageTime = messages.length ? messages[0].time : null;
  loadMoreBtn.classList.toggle('hidden', messages.length < HISTORY_PAGE_SIZE);
});

socket.on('system-message', (text) => {
  appendSystemMessage(text);
  saveToHistory({ kind: 'system', text });
});

socket.on('typing', ({ nickname, isTyping }) => {
  typingIndicator.textContent = isTyping ? `${nickname}님이 입력 중...` : '';
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', { type: 'text', content: text });
  messageInput.value = '';
  socket.emit('typing', false);
});

messageInput.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1500);
});

// --- 스티커 피커 ---
// public/stickers 폴더에 있는 이미지를 스티커로 불러옴. 클릭하면 그 자리에서
// 바로 이미지 메시지로 전송됨.
async function buildEmojiPicker() {
  let files = [];
  try {
    const res = await fetch('/api/stickers');
    files = await res.json();
  } catch {
    files = [];
  }

  emojiPicker.innerHTML = files.length
    ? `<div class="picker-grid">${files
        .map(
          (name) =>
            `<button type="button" class="sticker-item" data-filename="${escapeHtml(name)}">
              <img src="/stickers/${encodeURIComponent(name)}" alt="${escapeHtml(name)}" loading="lazy" />
            </button>`
        )
        .join('')}</div>`
    : `<div class="picker-empty">public/stickers 폴더에 이미지를 넣어보세요</div>`;
}

function sendSticker(filename) {
  socket.emit('chat-message', { type: 'sticker', content: filename });
}

emojiBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const willOpen = emojiPicker.classList.contains('hidden');
  emojiPicker.classList.toggle('hidden');
  if (willOpen) await buildEmojiPicker();
});

emojiPicker.addEventListener('click', (e) => {
  const stickerBtnEl = e.target.closest('.sticker-item');
  if (stickerBtnEl) {
    sendSticker(stickerBtnEl.dataset.filename);
    emojiPicker.classList.add('hidden');
  }
});

document.addEventListener('click', (e) => {
  if (!emojiPicker.classList.contains('hidden') && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.classList.add('hidden');
  }
});
