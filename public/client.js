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

let myNickname = '';
let hasJoined = false;
let typingTimeout = null;

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

// 소켓이 (재)연결될 때마다 실행됨. 이미 입장했던 상태라면 같은 닉네임/clientId로
// 자동 재입장해서, 연결이 끊겼다 붙어도 "내 메시지"가 계속 정확히 표시되게 함.
socket.on('connect', () => {
  if (hasJoined) {
    socket.emit('join', { nickname: myNickname, clientId: myClientId });
  }
});

socket.on('joined', ({ nickname }) => {
  myNickname = nickname;
  hasJoined = true;
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  messageInput.focus();
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

function appendMessage({ nickname, message, time, clientId }) {
  const div = document.createElement('div');
  const isMe = clientId === myClientId;
  div.className = `msg ${isMe ? 'me' : 'other'}`;
  div.innerHTML = `
    ${isMe ? '' : `<div class="msg-nick">${escapeHtml(nickname)}</div>`}
    <div class="msg-text"></div>
    <div class="msg-time">${formatTime(time)}</div>
  `;
  div.querySelector('.msg-text').textContent = message;
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

socket.on('chat-message', appendMessage);
socket.on('system-message', appendSystemMessage);

socket.on('typing', ({ nickname, isTyping }) => {
  typingIndicator.textContent = isTyping ? `${nickname}님이 입력 중...` : '';
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  messageInput.value = '';
  socket.emit('typing', false);
});

messageInput.addEventListener('input', () => {
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => socket.emit('typing', false), 1500);
});

// --- 이모티콘 피커 ---
const EMOJIS = [
  '😀', '😂', '😅', '😊', '😍', '🥰', '😘', '😎', '🤔', '😴',
  '😭', '😡', '🥳', '😱', '🙄', '😬', '🤯', '🥺', '😷', '🤗',
  '👍', '👎', '👏', '🙏', '💪', '🙌', '👌', '✌️', '🤝', '💕',
  '❤️', '🔥', '✨', '🎉', '🎈', '☕', '🍺', '🍕', '⭐', '💯',
];

emojiPicker.innerHTML = EMOJIS.map((e) => `<button type="button" class="emoji-item">${e}</button>`).join('');

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPicker.classList.toggle('hidden');
});

emojiPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('.emoji-item');
  if (!btn) return;
  // 커서 위치에 이모티콘 삽입
  const start = messageInput.selectionStart ?? messageInput.value.length;
  const end = messageInput.selectionEnd ?? messageInput.value.length;
  const emoji = btn.textContent;
  messageInput.value = messageInput.value.slice(0, start) + emoji + messageInput.value.slice(end);
  const cursor = start + emoji.length;
  messageInput.focus();
  messageInput.setSelectionRange(cursor, cursor);
});

document.addEventListener('click', (e) => {
  if (!emojiPicker.classList.contains('hidden') && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.classList.add('hidden');
  }
});
