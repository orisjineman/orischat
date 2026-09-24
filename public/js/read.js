import { messagesEl } from './elements.js';
import { socket } from './socket.js';
import { state } from './state.js';

// 탭이 보이는 상태에서만 "읽었다"고 보냄 — 백그라운드에 있는데 읽음 처리되는 건
// 이상하니까.
export function maybeMarkRead() {
  if (document.hidden || !state.latestMessageTime) return;
  socket.emit('mark-read', { time: state.latestMessageTime });
}

function updateReadStatuses() {
  messagesEl.querySelectorAll('.msg.me[data-time]').forEach((el) => {
    const statusEl = el.querySelector('.read-status');
    if (!statusEl) return;
    const time = Number(el.dataset.time);
    statusEl.textContent = state.roomMinReadTime > 0 && time <= state.roomMinReadTime ? '읽음' : '';
  });
}

socket.on('read-update', ({ minReadTime }) => {
  state.roomMinReadTime = minReadTime || 0;
  updateReadStatuses();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) maybeMarkRead();
});
