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

let myNickname = '';
let typingTimeout = null;

function join() {
  const name = nicknameInput.value.trim();
  if (!name) {
    nicknameInput.focus();
    return;
  }
  socket.emit('join', name);
}

joinBtn.addEventListener('click', join);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') join();
});

socket.on('joined', (nickname) => {
  myNickname = nickname;
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

function appendMessage({ nickname, message, time }) {
  const div = document.createElement('div');
  const isMe = nickname === myNickname;
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
