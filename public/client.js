const socket = io();

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const nicknameInput = document.getElementById('nickname-input');
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

// 브라우저마다 고유한 ID. 재연결(화면 꺼짐/네트워크 전환 등)되어도 "내 메시지"를
// 정확히 구분하기 위해 사용 — 닉네임만으로 비교하면 재연결 시나 동명 닉네임일 때
// 남의 메시지가 내 메시지로(또는 반대로) 잘못 표시될 수 있음.
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
const HISTORY_KEY = 'orischat-history';
const HISTORY_LIMIT = 200;

let myNickname = sessionStorage.getItem(NICKNAME_KEY) || '';
let myPin = sessionStorage.getItem(PIN_KEY) || '';
let hasJoined = false;
let typingTimeout = null;

// 새로고침 시 로그인 화면이 잠깐이라도 보이지 않도록, 저장된 닉네임이 있으면
// 곧바로 채팅 화면을 보여주고 뒤에서 재입장을 시도함.
if (myNickname) {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
}

// 서버에 비밀번호가 설정되어 있을 때만 입력칸을 보여줌
fetch('/api/config')
  .then((res) => res.json())
  .then(({ pinRequired }) => {
    if (pinRequired) pinInput.classList.remove('hidden');
  })
  .catch(() => {});

function loadHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveToHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  while (history.length > HISTORY_LIMIT) history.shift();
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
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
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // 무시
    }
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
    updateNotifyButton(); // denied/granted면 그냥 현재 상태 문구만 다시 보여줌
  }
});

updateNotifyButton();

function join() {
  const name = nicknameInput.value.trim();
  if (!name) {
    nicknameInput.focus();
    return;
  }
  requestNotificationPermission(); // 버튼 클릭(사용자 제스처) 시점에 물어봐야 브라우저가 허용함
  myNickname = name;
  myPin = pinInput.value;
  joinError.classList.add('hidden');
  socket.emit('join', { nickname: name, clientId: myClientId, pin: myPin });
}

joinBtn.addEventListener('click', join);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

// 소켓이 (재)연결될 때마다 실행됨 — 페이지를 새로고침한 첫 연결이든, 네트워크가
// 끊겼다 다시 붙은 재연결이든 동일하게 저장된 닉네임/clientId로 자동 (재)입장함.
socket.on('connect', () => {
  if (myNickname) {
    socket.emit('join', { nickname: myNickname, clientId: myClientId, pin: myPin });
  }
});

socket.on('joined', ({ nickname }) => {
  const firstTime = !hasJoined;
  myNickname = nickname;
  hasJoined = true;
  sessionStorage.setItem(NICKNAME_KEY, nickname);
  sessionStorage.setItem(PIN_KEY, myPin);
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

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
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

function renderReactions(container, reactionsObj) {
  container.innerHTML = '';
  Object.entries(reactionsObj || {}).forEach(([emoji, ids]) => {
    if (!ids || !ids.length) return;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'reaction-pill' + (ids.includes(myClientId) ? ' mine' : '');
    pill.dataset.emoji = emoji;
    pill.textContent = `${emoji} ${ids.length}`;
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

// --- 메시지 렌더링 ---
function appendMessage({ id, type, content, message, nickname, time, clientId, reactions }) {
  const div = document.createElement('div');
  const isMe = clientId === myClientId;
  // 구버전 서버 호환: type이 없으면 텍스트 메시지(message 필드)로 취급
  const kind = type || 'text';
  const text = content ?? message ?? '';

  div.className = `msg ${isMe ? 'me' : 'other'} ${kind === 'sticker' ? 'sticker' : ''}`;
  if (id) div.dataset.messageId = id;
  div.innerHTML = `
    ${isMe ? '' : `<div class="msg-nick">${escapeHtml(nickname)}</div>`}
    <div class="msg-body"></div>
    <div class="msg-footer">
      <span class="msg-time">${formatTime(time)}</span>
      ${id ? '<button type="button" class="react-btn" aria-label="반응 추가">🙂</button>' : ''}
    </div>
    <div class="msg-reactions"></div>
  `;

  const body = div.querySelector('.msg-body');
  if (kind === 'sticker') {
    const img = document.createElement('img');
    img.src = `/stickers/${encodeURIComponent(text)}`;
    img.alt = '스티커';
    img.className = 'sticker-img';
    body.appendChild(img);
  } else {
    body.textContent = text;
  }

  if (reactions) {
    renderReactions(div.querySelector('.msg-reactions'), reactions);
  }

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

// 탭이 안 보일 때 새 메시지가 오면 브라우저 알림을 띄움
function maybeNotify(payload) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (payload.clientId === myClientId) return;
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

// 서버가 DB에서 불러온 진짜 대화 기록. sessionStorage 캐시(새로고침 전까지의
// 임시 복원용)를 서버가 알려주는 정확한 내용으로 교체함 — 이렇게 하면 새로
// 들어온 사람도 지난 대화를 볼 수 있고, 중복 표시도 안 생김.
socket.on('history', (messages) => {
  messagesEl.innerHTML = '';
  sessionStorage.removeItem(HISTORY_KEY);
  messages.forEach((payload) => {
    appendMessage(payload);
    saveToHistory({ kind: 'chat', payload });
  });
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
