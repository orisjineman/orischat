const socket = io();

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const nicknameInput = document.getElementById('nickname-input');
const joinBtn = document.getElementById('join-btn');
const userList = document.getElementById('user-list');
const messagesEl = document.getElementById('messages');
const typingIndicator = document.getElementById('typing-indicator');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');

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
const HISTORY_KEY = 'orischat-history';
const HISTORY_LIMIT = 200;

let myNickname = sessionStorage.getItem(NICKNAME_KEY) || '';
let hasJoined = false;
let typingTimeout = null;

// 새로고침 시 로그인 화면이 잠깐이라도 보이지 않도록, 저장된 닉네임이 있으면
// 곧바로 채팅 화면을 보여주고 뒤에서 재입장을 시도함.
if (myNickname) {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
}

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

function join() {
  const name = nicknameInput.value.trim();
  if (!name) {
    nicknameInput.focus();
    return;
  }
  myNickname = name;
  socket.emit('join', { nickname: name, clientId: myClientId });
}

joinBtn.addEventListener('click', join);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

// 소켓이 (재)연결될 때마다 실행됨 — 페이지를 새로고침한 첫 연결이든, 네트워크가
// 끊겼다 다시 붙은 재연결이든 동일하게 저장된 닉네임/clientId로 자동 (재)입장함.
socket.on('connect', () => {
  if (myNickname) {
    socket.emit('join', { nickname: myNickname, clientId: myClientId });
  }
});

socket.on('joined', ({ nickname }) => {
  const firstTime = !hasJoined;
  myNickname = nickname;
  hasJoined = true;
  sessionStorage.setItem(NICKNAME_KEY, nickname);
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  if (firstTime) {
    messageInput.focus();
  }
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

function appendMessage({ type, content, message, nickname, time, clientId }) {
  const div = document.createElement('div');
  const isMe = clientId === myClientId;
  // 구버전 서버 호환: type이 없으면 텍스트 메시지(message 필드)로 취급
  const kind = type || 'text';
  const text = content ?? message ?? '';

  div.className = `msg ${isMe ? 'me' : 'other'} ${kind === 'sticker' ? 'sticker' : ''}`;
  div.innerHTML = `
    ${isMe ? '' : `<div class="msg-nick">${escapeHtml(nickname)}</div>`}
    <div class="msg-body"></div>
    <div class="msg-time">${formatTime(time)}</div>
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

// 새로고침 시 sessionStorage에 저장해둔 이전 대화를 먼저 복원
loadHistory().forEach((entry) => {
  if (entry.kind === 'chat') appendMessage(entry.payload);
  else if (entry.kind === 'system') appendSystemMessage(entry.text);
});

socket.on('chat-message', (payload) => {
  appendMessage(payload);
  saveToHistory({ kind: 'chat', payload });
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
