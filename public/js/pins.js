import { pinBar, pinBarMain, pinBarToggle, pinList, messagesEl } from './elements.js';
import { jumpToMessage } from './messages.js';
import { socket } from './socket.js';
import { state } from './state.js';
import { showToast } from './toast.js';

// 방의 고정 메시지: 대화 위쪽 바에 가장 최근 고정을 보여주고, 펼치면 전체 목록(이동/해제).
let listOpen = false;

const label = (p) => `${p.nickname}: ${p.preview}`;

function syncPinnedFlags() {
  messagesEl.querySelectorAll('.msg[data-message-id]').forEach((el) => {
    el.classList.toggle('pinned', state.pinnedIds.has(el.dataset.messageId));
  });
}

function render() {
  const pins = state.pins;
  pinBar.classList.toggle('hidden', pins.length === 0);
  if (pins.length === 0) {
    listOpen = false;
    pinList.classList.add('hidden');
    return;
  }
  pinBarMain.textContent = label(pins[0]);
  pinBarToggle.textContent = `${pins.length}개 ${listOpen ? '▴' : '▾'}`;
  pinList.classList.toggle('hidden', !listOpen);

  pinList.textContent = '';
  for (const p of pins) {
    const row = document.createElement('div');
    row.className = 'pin-row';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'pin-row-main';
    go.dataset.pinId = p.id;
    go.dataset.time = p.time;
    go.textContent = label(p);
    const unpin = document.createElement('button');
    unpin.type = 'button';
    unpin.className = 'pin-row-unpin';
    unpin.dataset.pinId = p.id;
    unpin.setAttribute('aria-label', '고정 해제');
    unpin.textContent = '✕';
    row.append(go, unpin);
    pinList.appendChild(row);
  }
}

socket.on('pins', (list) => {
  state.pins = Array.isArray(list) ? list : [];
  state.pinnedIds = new Set(state.pins.map((p) => p.id));
  render();
  syncPinnedFlags();
});

socket.on('pin-error', (msg) => showToast(msg, 3500));

pinBarMain.addEventListener('click', () => {
  const latest = state.pins[0];
  if (latest) jumpToMessage({ id: latest.id, time: latest.time });
});

pinBarToggle.addEventListener('click', () => {
  listOpen = !listOpen;
  render();
});

pinList.addEventListener('click', (e) => {
  const unpin = e.target.closest('.pin-row-unpin');
  if (unpin) {
    socket.emit('unpin-message', { messageId: unpin.dataset.pinId });
    return;
  }
  const go = e.target.closest('.pin-row-main');
  if (go) jumpToMessage({ id: go.dataset.pinId, time: Number(go.dataset.time) });
});
