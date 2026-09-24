import { IMAGE_MAX_LENGTH } from './constants.js';
import {
  attachBtn,
  emojiBtn,
  emojiPicker,
  fileInput,
  messageForm,
  messageInput,
} from './elements.js';
import { resizeImageFile } from './imageFile.js';
import { clearReply } from './reply.js';
import { socket } from './socket.js';
import { state } from './state.js';
import { escapeHtml } from './text.js';

// 답장 중이면 함께 실어서 보내고, 보낸 뒤엔 답장 상태를 비움
function sendChatMessage(data) {
  const payload = { ...data };
  if (state.pendingReplyTo) {
    payload.replyTo = state.pendingReplyTo;
    clearReply();
  }
  socket.emit('chat-message', payload);
}

let typingTimeout = null;

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

emojiBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const willOpen = emojiPicker.classList.contains('hidden');
  emojiPicker.classList.toggle('hidden');
  if (willOpen) await buildEmojiPicker();
});

emojiPicker.addEventListener('click', (e) => {
  const stickerBtnEl = e.target.closest('.sticker-item');
  if (stickerBtnEl) {
    sendChatMessage({ type: 'sticker', content: stickerBtnEl.dataset.filename });
    emojiPicker.classList.add('hidden');
  }
});

document.addEventListener('click', (e) => {
  if (!emojiPicker.classList.contains('hidden') && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.classList.add('hidden');
  }
});

// --- 사진 첨부 ---
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
