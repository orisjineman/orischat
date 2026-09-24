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
const roomListEl = document.getElementById('room-list');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const replyBanner = document.getElementById('reply-banner');
const replyBannerText = document.getElementById('reply-banner-text');
const replyCancelBtn = document.getElementById('reply-cancel-btn');
const searchBtn = document.getElementById('search-btn');
const searchPanel = document.getElementById('search-panel');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchCloseBtn = document.getElementById('search-close-btn');
const searchResults = document.getElementById('search-results');
const avatarBtn = document.getElementById('avatar-btn');
const avatarEditBtn = document.getElementById('avatar-edit-btn');
const avatarFileInput = document.getElementById('avatar-file-input');
const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
const imageLightbox = document.getElementById('image-lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxCloseBtn = document.getElementById('lightbox-close-btn');

const IMAGE_MAX_LENGTH = 700_000; // 서버와 동일한 상한 (대략 500KB 원본에 해당)
const AVATAR_MAX_LENGTH = 250_000; // 서버와 동일한 프로필 사진 상한

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
let latestMessageTime = 0; // 읽음 표시용 — 지금까지 화면에 그려진 메시지 중 가장 최신 시각
let roomMinReadTime = 0; // 나를 제외한 방 안 모두가 최소 어디까지 읽었는지

// 닉네임 -> 프로필 사진 버전(updatedAt). 캐시 무효화(cache-busting)용 —
// 사진이 바뀌면 버전도 바뀌어서 브라우저가 새로 받아오게 됨.
const avatarVersions = new Map();

if (roomFromUrl()) roomInput.value = roomFromUrl();

// 로그인 화면에 "지금 활동 중이거나 기록이 있는 방" 목록을 보여줌 — 방 이름을
// 정확히 몰라도 골라서 들어갈 수 있게.
async function loadRoomList() {
  try {
    const res = await fetch('/api/rooms');
    const rooms = await res.json();
    roomListEl.innerHTML = rooms
      .map(
        (r) =>
          `<button type="button" class="room-item" data-room="${escapeHtml(r.name)}">${escapeHtml(r.name)}${
            r.activeUsers ? ` · ${r.activeUsers}명 접속중` : ''
          }</button>`
      )
      .join('');
  } catch {
    roomListEl.innerHTML = '';
  }
}
loadRoomList();

roomListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.room-item');
  if (btn) roomInput.value = btn.dataset.room;
});

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
  saveHistory(history);
}

function saveHistory(history) {
  try {
    sessionStorage.setItem(historyKey(), JSON.stringify(history));
  } catch {
    // 무시 (히스토리 유지는 보너스 기능이라 실패해도 괜찮음)
  }
}

// 저장해둔 히스토리 중 해당 메시지의 payload를 고쳐서, 새로고침해도 리액션/삭제/
// 수정 상태가 유지되게 함
function updateHistoryEntry(messageId, mutate) {
  const history = loadHistory();
  let changed = false;
  for (const entry of history) {
    if (entry.kind === 'chat' && entry.payload && entry.payload.id === messageId) {
      mutate(entry.payload);
      changed = true;
    }
  }
  if (changed) saveHistory(history);
}

function findMessageEl(messageId) {
  return messagesEl.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
}

// --- 테마 선택 (시스템 설정보다 수동 선택이 우선 적용됨) ---
const THEME_KEY = 'orischat-theme';
const THEME_OPTIONS = [
  { value: '', icon: '🌓', label: '시스템 설정' },
  { value: 'light', icon: '☀️', label: '라이트' },
  { value: 'dark', icon: '🌙', label: '다크' },
  { value: 'intellij', icon: '🧠', label: 'IntelliJ' },
  { value: 'excel', icon: '📊', label: 'Excel' },
];

function applyTheme(theme) {
  const opt = THEME_OPTIONS.find((o) => o.value === (theme || '')) || THEME_OPTIONS[0];
  if (opt.value) document.documentElement.setAttribute('data-theme', opt.value);
  else document.documentElement.removeAttribute('data-theme');
  themeToggleBtn.textContent = opt.icon;
  themePicker.querySelectorAll('.theme-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeValue === opt.value);
  });
}

const themePicker = document.createElement('div');
themePicker.id = 'theme-picker';
themePicker.className = 'hidden';
themePicker.innerHTML = THEME_OPTIONS.map(
  (o) => `<button type="button" class="theme-option" data-theme-value="${o.value}">${o.icon} ${o.label}</button>`
).join('');
document.body.appendChild(themePicker);
applyTheme(localStorage.getItem(THEME_KEY));

themeToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = themePicker.classList.contains('hidden');
  if (opening) {
    const rect = themeToggleBtn.getBoundingClientRect();
    themePicker.style.top = `${rect.bottom + window.scrollY + 6}px`;
    themePicker.style.right = `${window.innerWidth - rect.right}px`;
  }
  themePicker.classList.toggle('hidden');
});

themePicker.addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-option');
  if (!btn) return;
  const value = btn.dataset.themeValue;
  if (value) localStorage.setItem(THEME_KEY, value);
  else localStorage.removeItem(THEME_KEY);
  applyTheme(value);
  themePicker.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!themePicker.classList.contains('hidden') && e.target !== themeToggleBtn && !themePicker.contains(e.target)) {
    themePicker.classList.add('hidden');
  }
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
[nicknameInput, roomInput, pinInput].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
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
  latestMessageTime = 0;
  roomMinReadTime = 0;
  sessionStorage.setItem(NICKNAME_KEY, nickname);
  sessionStorage.setItem(PIN_KEY, myPin);
  sessionStorage.setItem(ROOM_KEY, room);
  updateRoomLabel(room);
  updateUrlForRoom(room);
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  refreshMyAvatarButton();
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

// 방에 있는 사람들 닉네임 — @멘션 하이라이트를 판단할 때 씀
let currentRoomUsers = [];

socket.on('user-list', (users) => {
  currentRoomUsers = users;
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

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 메시지 안의 http(s):// 링크는 클릭 가능한 <a>로, "@닉네임"(현재 방에 있는
// 사람만)은 하이라이트로 바꿔줌. 그 외 텍스트는 그대로 텍스트 노드라 escape됨.
function renderLinkedText(container, text, mentionNames = []) {
  container.textContent = '';

  // 닉네임이 다른 닉네임의 앞부분과 겹칠 수 있어서(예: "김"과 "김철수"), 긴
  // 것부터 매칭되도록 길이 내림차순으로 정렬함.
  const names = Array.from(new Set(mentionNames)).filter(Boolean).sort((a, b) => b.length - a.length);
  const mentionAlternation = names.map((n) => `@${escapeRegExp(n)}`).join('|');
  const pattern = mentionAlternation
    ? new RegExp(`(https?:\\/\\/[^\\s]+)|(${mentionAlternation})`, 'g')
    : /(https?:\/\/[^\s]+)/g;

  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    if (match[1]) {
      const a = document.createElement('a');
      a.href = match[1];
      a.textContent = match[1];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      container.appendChild(a);
    } else if (match[2]) {
      const span = document.createElement('span');
      span.className = 'mention';
      span.textContent = match[2];
      container.appendChild(span);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
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
  const clickedImg = e.target.closest('.msg-body .sticker-img');
  if (clickedImg) {
    openLightbox(clickedImg.src);
    return;
  }

  const replyQuote = e.target.closest('.reply-quote');
  if (replyQuote) {
    scrollToMessage(replyQuote.dataset.replyTarget);
    return;
  }

  const reactBtn = e.target.closest('.react-btn');
  if (reactBtn) {
    const msgEl = reactBtn.closest('.msg');
    openReactionPopup(reactBtn, msgEl.dataset.messageId);
    return;
  }

  const replyBtn = e.target.closest('.reply-btn');
  if (replyBtn) {
    const msgEl = replyBtn.closest('.msg');
    startReply(msgEl);
    return;
  }

  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    const msgEl = editBtn.closest('.msg');
    const body = msgEl.querySelector('.msg-body');
    const newText = prompt('메시지 수정', body ? body.textContent : '');
    if (newText != null && newText.trim() && newText.trim() !== (body ? body.textContent : '')) {
      socket.emit('edit-message', { messageId: msgEl.dataset.messageId, content: newText.trim() });
    }
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

socket.on('message-edited', ({ messageId, content, editedAt }) => {
  const msgEl = findMessageEl(messageId);
  if (msgEl) {
    renderLinkedText(msgEl.querySelector('.msg-body'), content, currentRoomUsers);
    const timeEl = msgEl.querySelector('.msg-time');
    if (timeEl && !timeEl.textContent.includes('(수정됨)')) timeEl.textContent += ' (수정됨)';
  }
  updateHistoryEntry(messageId, (p) => {
    p.content = content;
    p.edited = true;
  });
});

// --- 답장 ---
let pendingReplyTo = null;

function startReply(msgEl) {
  const nickname = msgEl.classList.contains('me') ? myNickname : msgEl.querySelector('.msg-nick')?.textContent.trim() || '';
  const body = msgEl.querySelector('.msg-body');
  const isMedia = msgEl.querySelector('.sticker-img');
  const preview = isMedia ? (msgEl.classList.contains('sticker') && msgEl.querySelector('.chat-image') ? '사진' : '스티커') : (body ? body.textContent : '');

  pendingReplyTo = { id: msgEl.dataset.messageId, nickname, preview: preview.slice(0, 120) };
  replyBannerText.textContent = `${nickname}님에게 답장: ${pendingReplyTo.preview}`;
  replyBanner.classList.remove('hidden');
  messageInput.focus();
}

function clearReply() {
  pendingReplyTo = null;
  replyBanner.classList.add('hidden');
}

replyCancelBtn.addEventListener('click', clearReply);

socket.on('reaction-update', ({ messageId, reactions }) => {
  const msgEl = findMessageEl(messageId);
  if (msgEl) {
    renderReactions(msgEl.querySelector('.msg-reactions'), reactions);
  }
  updateHistoryEntry(messageId, (p) => {
    p.reactions = reactions;
  });
});

socket.on('message-deleted', ({ messageId }) => {
  const msgEl = findMessageEl(messageId);
  if (msgEl) applyDeletedState(msgEl);
  updateHistoryEntry(messageId, (p) => {
    p.deleted = true;
  });
});

function applyDeletedState(msgEl) {
  msgEl.classList.add('deleted');
  const body = msgEl.querySelector('.msg-body');
  if (body) body.textContent = '삭제된 메시지입니다';
  const reactionsEl = msgEl.querySelector('.msg-reactions');
  if (reactionsEl) reactionsEl.innerHTML = '';
  ['.react-btn', '.delete-btn', '.reply-btn', '.edit-btn'].forEach((sel) => {
    const el = msgEl.querySelector(sel);
    if (el) el.remove();
  });
}

// 프로필 사진(닉네임 기준)이 있으면 그걸, 없으면(또는 로드 실패하면) 이니셜
// 배지를 보여주는 엘리먼트를 만듦. avatar-updated 이벤트가 오면 이 함수로
// 다시 만들어서 교체함.
function createAvatarEl(nickname, { clickable = true } = {}) {
  const img = document.createElement('img');
  img.className = 'msg-avatar msg-avatar-img';
  img.alt = '';
  img.dataset.avatarNickname = nickname;
  img.src = `/avatar/${encodeURIComponent(nickname)}?v=${avatarVersions.get(nickname) || 0}`;
  if (clickable) {
    img.classList.add('avatar-clickable');
    // 사진이 없어서 onerror로 이니셜 배지로 바뀌기 전까지만 클릭이 유효함
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(img.src);
    });
  }
  img.onerror = () => {
    const span = document.createElement('span');
    span.className = 'msg-avatar';
    span.style.background = nicknameColor(nickname);
    span.textContent = nicknameInitial(nickname);
    span.dataset.avatarNickname = nickname;
    img.replaceWith(span);
  };
  return img;
}

// --- 메시지 렌더링 ---
// payload: { id, type, content, nickname, time, mine, reactions, deleted, replyTo, mentions, edited }
function buildMessageEl({ id, type, content, message, nickname, time, mine, reactions, deleted, replyTo, edited }) {
  const div = document.createElement('div');
  // 구버전 서버 호환: type이 없으면 텍스트 메시지(message 필드)로 취급
  const kind = type || 'text';
  const text = content ?? message ?? '';

  div.className = `msg ${mine ? 'me' : 'other'} ${kind === 'sticker' || kind === 'image' ? 'sticker' : ''}`;
  if (id) div.dataset.messageId = id;
  if (time) div.dataset.time = time;

  const replyHtml = replyTo
    ? `<div class="reply-quote" data-reply-target="${escapeHtml(replyTo.id)}">↩ ${escapeHtml(
        replyTo.nickname
      )}: ${escapeHtml(replyTo.preview)}</div>`
    : '';

  div.innerHTML = `
    ${replyHtml}
    <div class="msg-body"></div>
    <div class="msg-footer">
      <span class="msg-time">${formatTime(time)}${edited ? ' (수정됨)' : ''}</span>
      ${mine && !deleted ? '<span class="read-status"></span>' : ''}
      ${id && !deleted ? '<button type="button" class="reply-btn" aria-label="답장">↩</button>' : ''}
      ${id && !deleted ? '<button type="button" class="react-btn" aria-label="반응 추가">🙂</button>' : ''}
      ${id && mine && kind === 'text' && !deleted ? '<button type="button" class="edit-btn" aria-label="수정">✏️</button>' : ''}
      ${id && mine && !deleted ? '<button type="button" class="delete-btn" aria-label="삭제">🗑</button>' : ''}
    </div>
    <div class="msg-reactions"></div>
  `;

  if (!mine) {
    const nickDiv = document.createElement('div');
    nickDiv.className = 'msg-nick';
    nickDiv.appendChild(createAvatarEl(nickname));
    nickDiv.appendChild(document.createTextNode(nickname));
    div.insertBefore(nickDiv, div.firstChild);
  }

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
  } else if (kind === 'image') {
    const img = document.createElement('img');
    img.src = text;
    img.alt = '사진';
    img.className = 'sticker-img chat-image';
    body.appendChild(img);
  } else {
    renderLinkedText(body, text, currentRoomUsers);
  }

  if (reactions && !deleted) {
    renderReactions(div.querySelector('.msg-reactions'), reactions);
  }

  return div;
}

// 대화를 위로 스크롤해서 지난 메시지를 읽던 중이면, 새 메시지가 와도 화면을
// 억지로 맨 아래로 당기지 않음 — 이미 맨 아래 근처에 있을 때만 자동으로
// 따라 내려감. 그 외엔 스크롤 버튼을 보여줘서 원할 때 이동하게 함.
const NEAR_BOTTOM_THRESHOLD = 80;
function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < NEAR_BOTTOM_THRESHOLD;
}

function scrollToBottom(behavior = 'auto') {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
  scrollBottomBtn.classList.add('hidden');
}

function appendMessage(payload) {
  const wasNearBottom = isNearBottom();
  const div = buildMessageEl(payload);
  messagesEl.appendChild(div);
  if (wasNearBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else {
    scrollBottomBtn.classList.remove('hidden');
  }
}

function appendSystemMessage(text) {
  const wasNearBottom = isNearBottom();
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  messagesEl.appendChild(div);
  if (wasNearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

scrollBottomBtn.addEventListener('click', () => scrollToBottom('smooth'));

// 위로 스크롤해서 지난 대화를 보고 있으면 버튼을 보여주고, 맨 아래 근처로
// 돌아오면 다시 숨김 — 새 메시지가 왔을 때뿐 아니라 언제든 쓸 수 있게 함
messagesEl.addEventListener('scroll', () => {
  const scrollable = messagesEl.scrollHeight > messagesEl.clientHeight + NEAR_BOTTOM_THRESHOLD;
  scrollBottomBtn.classList.toggle('hidden', !scrollable || isNearBottom());
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 탭이 안 보일 때 새 메시지가 오면 브라우저 알림을 띄움 (백그라운드 푸시가 안 될 때의 대체 수단).
// 단, @멘션은 "우선 알림"이라 탭을 보고 있어도 띄움.
function maybeNotify(payload) {
  if (pushSubscribed) return; // 푸시가 켜져 있으면 Service Worker가 알림을 담당함
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (payload.mine) return;

  const isMention = Array.isArray(payload.mentions) && payload.mentions.includes(myNickname);
  if (!isMention && !document.hidden) return;

  // 메시지 내용은 알림에 노출하지 않음 (잠금화면 등에서 다른 사람이 볼 수 있어서)
  const title = isMention
    ? `${payload.nickname || '누군가'}님이 회원님을 언급했습니다`
    : `${payload.nickname || '누군가'}님이 메시지를 보냈습니다`;
  try {
    const n = new Notification(title, {
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
  if (payload.time > latestMessageTime) latestMessageTime = payload.time;
  maybeMarkRead();
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
  if (messages.length) latestMessageTime = messages[messages.length - 1].time;
  maybeMarkRead();
  loadMoreBtn.classList.toggle('hidden', messages.length < HISTORY_PAGE_SIZE);
});

socket.on('system-message', (text) => {
  appendSystemMessage(text);
  saveToHistory({ kind: 'system', text });
});

socket.on('typing', ({ nickname, isTyping }) => {
  typingIndicator.textContent = isTyping ? `${nickname}님이 입력 중...` : '';
});

// 답장 중이면 함께 실어서 보내고, 보낸 뒤엔 답장 상태를 비움
function sendChatMessage(data) {
  const payload = { ...data };
  if (pendingReplyTo) {
    payload.replyTo = pendingReplyTo;
    clearReply();
  }
  socket.emit('chat-message', payload);
}

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  sendChatMessage({ type: 'text', content: text });
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
  sendChatMessage({ type: 'sticker', content: filename });
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

// --- 사진 첨부 ---
// 서버 파일시스템에는 저장 안 함(Render 무료 플랜은 재시작하면 파일이 날아감).
// 대신 브라우저에서 캔버스로 리사이즈/압축한 뒤 base64로 DB에 저장함 — 7일 지나면
// 자동 삭제되니 무료 DB 용량도 자연스럽게 관리됨.
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    reader.readAsDataURL(file);
  });
}

async function resizeImageFile(file, maxDimension, quality) {
  const img = await loadImageFromFile(file);
  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;

  try {
    let dataUrl = await resizeImageFile(file, 1280, 0.7);
    if (dataUrl.length > IMAGE_MAX_LENGTH) {
      dataUrl = await resizeImageFile(file, 800, 0.5); // 그래도 크면 한 번 더 압축
    }
    if (dataUrl.length > IMAGE_MAX_LENGTH) {
      alert('이미지 용량이 너무 큽니다. 더 작은 사진을 선택해주세요.');
      return;
    }
    sendChatMessage({ type: 'image', content: dataUrl });
  } catch {
    alert('이미지를 처리하지 못했습니다.');
  }
});

socket.on('upload-error', (msg) => {
  alert(msg);
});

// --- 방 안 메시지 검색 ---
searchBtn.addEventListener('click', () => {
  searchPanel.classList.toggle('hidden');
  if (!searchPanel.classList.contains('hidden')) searchInput.focus();
});

searchCloseBtn.addEventListener('click', () => {
  searchPanel.classList.add('hidden');
});

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  searchResults.textContent = '검색 중...';
  socket.emit('search-messages', { query }, (results) => {
    if (!results || results.length === 0) {
      searchResults.textContent = '검색 결과가 없습니다.';
      return;
    }
    searchResults.innerHTML = '';
    results
      .slice()
      .reverse()
      .forEach((payload) => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const meta = document.createElement('div');
        meta.className = 'search-result-meta';
        meta.textContent = `${payload.nickname} · ${formatTime(payload.time)}`;
        const body = document.createElement('div');
        renderLinkedText(body, payload.content, currentRoomUsers);
        item.appendChild(meta);
        item.appendChild(body);
        searchResults.appendChild(item);
      });
  });
});

// --- 사진/스티커 확대 보기(라이트박스) ---
function openLightbox(src) {
  lightboxImg.src = src;
  imageLightbox.classList.remove('hidden');
}

function closeLightbox() {
  imageLightbox.classList.add('hidden');
  lightboxImg.src = '';
}

imageLightbox.addEventListener('click', closeLightbox);
lightboxCloseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closeLightbox();
});
// 이미지 자체를 클릭했을 때는(배경 클릭과 달리) 안 닫히게 — 실수로 닫히는 것 방지
lightboxImg.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !imageLightbox.classList.contains('hidden')) closeLightbox();
});

// --- 답장 인용 클릭 시 원본 메시지로 스크롤 ---
function scrollToMessage(messageId) {
  if (!messageId) return;
  const target = findMessageEl(messageId);
  if (!target) return; // "이전 메시지 더 보기"로 아직 안 불러온 경우 등 — 조용히 무시

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('flash-highlight');
  setTimeout(() => target.classList.remove('flash-highlight'), 1200);
}

// --- 프로필 사진 설정 ---
async function resizeImageSquare(file, size, quality) {
  const img = await loadImageFromFile(file);
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', quality);
}

// 내 메시지 말풍선엔 원래 닉네임/아바타를 안 보여줘서(색으로만 구분), 프로필
// 사진을 올려도 확인할 방법이 없었음 — 헤더 버튼 자체가 내 현재 프로필 사진을
// 보여주게 해서 바로 확인 가능하게 함.
function refreshMyAvatarButton() {
  if (!myNickname) return;
  avatarBtn.innerHTML = '';
  // 버튼 자체는 "크게 보기" 클릭을 담당하므로, 내부 이미지는 클릭 핸들러가
  // 따로 없는 버전으로 만듦 (이벤트 버블링이 막히면 버튼 클릭이 씹힘)
  const el = createAvatarEl(myNickname, { clickable: false });
  el.classList.add('avatar-btn-img');
  avatarBtn.appendChild(el);
}

avatarBtn.addEventListener('click', () => {
  if (!myNickname) return;
  // 사진을 설정 안 했으면(이니셜 배지만 있으면) 확대해서 볼 게 없으니 바로
  // 사진 설정 화면으로 보냄
  if (!avatarBtn.querySelector('img')) {
    avatarFileInput.click();
    return;
  }
  openLightbox(`/avatar/${encodeURIComponent(myNickname)}?v=${avatarVersions.get(myNickname) || 0}`);
});

avatarEditBtn.addEventListener('click', () => avatarFileInput.click());

avatarFileInput.addEventListener('change', async () => {
  const file = avatarFileInput.files[0];
  avatarFileInput.value = '';
  if (!file) return;

  try {
    let dataUrl = await resizeImageSquare(file, 200, 0.85);
    if (dataUrl.length > AVATAR_MAX_LENGTH) {
      dataUrl = await resizeImageSquare(file, 120, 0.7); // 그래도 크면 한 번 더 압축
    }
    if (dataUrl.length > AVATAR_MAX_LENGTH) {
      alert('프로필 사진 용량이 너무 큽니다. 더 작은 사진을 선택해주세요.');
      return;
    }
    socket.emit('set-avatar', { content: dataUrl });
    // 서버 브로드캐스트가 오기 전에도 내 화면엔 바로 반영되게(체감 지연 줄이기)
    avatarVersions.set(myNickname, Date.now());
    document.querySelectorAll(`[data-avatar-nickname="${CSS.escape(myNickname)}"]`).forEach((el) => {
      el.replaceWith(createAvatarEl(myNickname));
    });
    refreshMyAvatarButton();
  } catch {
    alert('이미지를 처리하지 못했습니다.');
  }
});

socket.on('avatar-updated', ({ nickname, updatedAt }) => {
  avatarVersions.set(nickname, updatedAt);
  if (nickname === myNickname) refreshMyAvatarButton();
  document.querySelectorAll(`[data-avatar-nickname="${CSS.escape(nickname)}"]`).forEach((el) => {
    el.replaceWith(createAvatarEl(nickname));
  });
});

// --- 읽음 표시 ---
// 탭이 보이는 상태에서만 "읽었다"고 보냄 — 백그라운드에 있는데 읽음 처리되는 건
// 이상하니까.
function maybeMarkRead() {
  if (document.hidden || !latestMessageTime) return;
  socket.emit('mark-read', { time: latestMessageTime });
}

function updateReadStatuses() {
  messagesEl.querySelectorAll('.msg.me[data-time]').forEach((el) => {
    const statusEl = el.querySelector('.read-status');
    if (!statusEl) return;
    const time = Number(el.dataset.time);
    statusEl.textContent = roomMinReadTime > 0 && time <= roomMinReadTime ? '읽음' : '';
  });
}

socket.on('read-update', ({ minReadTime }) => {
  roomMinReadTime = minReadTime || 0;
  updateReadStatuses();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) maybeMarkRead();
});
