import { mentionPopup, messageInput } from './elements.js';
import { state } from './state.js';

// 입력창에서 "@"를 치면 방에 있는 사람 목록을 띄워서 골라 넣게 함.
const MAX_ITEMS = 6;
let items = [];
let activeIndex = 0;

// 커서 바로 앞의 "@검색어" 조각을 찾음 (앞이 공백이거나 문장 처음일 때만)
function currentToken() {
  const caret = messageInput.selectionStart ?? messageInput.value.length;
  const before = messageInput.value.slice(0, caret);
  const m = before.match(/(^|\s)@([^\s@]*)$/);
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1, end: caret };
}

function isOpen() {
  return !mentionPopup.classList.contains('hidden');
}

function close() {
  mentionPopup.classList.add('hidden');
  items = [];
}

function render() {
  mentionPopup.innerHTML = '';
  items.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mention-item' + (i === activeIndex ? ' active' : '');
    btn.dataset.name = name;
    btn.textContent = `@${name}`;
    mentionPopup.appendChild(btn);
  });
}

function refresh() {
  const token = currentToken();
  if (!token) return close();
  const q = token.query.toLowerCase();
  items = state.roomUsers
    .filter((n) => n !== state.nickname && n.toLowerCase().includes(q))
    .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)))
    .slice(0, MAX_ITEMS);
  if (!items.length) return close();
  activeIndex = 0;
  render();
  mentionPopup.classList.remove('hidden');
}

function choose(name) {
  const token = currentToken();
  if (!token) return close();
  const value = messageInput.value;
  const insert = `@${name} `;
  messageInput.value = value.slice(0, token.start) + insert + value.slice(token.end);
  const pos = token.start + insert.length;
  messageInput.setSelectionRange(pos, pos);
  close();
  messageInput.focus();
  messageInput.dispatchEvent(new (messageInput.ownerDocument.defaultView.Event)('input', { bubbles: true }));
}

messageInput.addEventListener('input', refresh);
messageInput.addEventListener('click', refresh);
messageInput.addEventListener('blur', () => setTimeout(close, 100));

messageInput.addEventListener('keydown', (e) => {
  if (!isOpen() || e.isComposing || e.keyCode === 229) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    render();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    choose(items[activeIndex]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
});

// mousedown에서 막아야 입력창이 포커스를 잃지 않음
mentionPopup.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const btn = e.target.closest('.mention-item');
  if (btn) choose(btn.dataset.name);
});
