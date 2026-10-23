// 메시지 안의 버튼/링크 클릭(이벤트 위임)과 길게 눌러 답장하기
import { messagesEl } from './elements.js';
import { startInlineEdit } from './inlineEdit.js';
import { openLightbox } from './lightbox.js';
import { openReactionPopup, sendReaction } from './reactions.js';
import { startReply } from './reply.js';
import { scrollToMessage } from './scroll.js';
import { socket } from './socket.js';
import { showToast } from './toast.js';

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

  const copyBtn = e.target.closest('.copy-btn');
  if (copyBtn) {
    const body = copyBtn.closest('.msg').querySelector('.msg-body');
    copyText(body ? body.textContent : '');
    return;
  }

  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    startInlineEdit(editBtn.closest('.msg'));
    return;
  }

  const pinBtn = e.target.closest('.pin-btn');
  if (pinBtn) {
    const msgEl = pinBtn.closest('.msg');
    socket.emit(msgEl.classList.contains('pinned') ? 'unpin-message' : 'pin-message', { messageId: msgEl.dataset.messageId });
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
    return;
  }

  // 그 밖에 말풍선을 탭하면 액션 버튼(답장/반응/복사...)을 펼치거나 접음 (터치 기기용)
  if (e.target.closest('a, .avatar-clickable, .inline-edit')) return;
  const tapped = e.target.closest('.msg:not(.system)');
  messagesEl.querySelectorAll('.msg.actions-open').forEach((el) => {
    if (el !== tapped) el.classList.remove('actions-open');
  });
  if (tapped) tapped.classList.toggle('actions-open');
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      // 복사 실패는 조용히 무시
    }
    ta.remove();
  }
  showToast('복사했어요');
}

// --- 길게 눌러서 답장 (터치 기기) ---
const LONG_PRESS_MS = 550;
let longPressTimer = null;

function cancelLongPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
}

messagesEl.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg:not(.system):not(.deleted)');
  if (!msgEl || !msgEl.dataset.messageId || e.target.closest('button, a, img, input')) return;
  cancelLongPress();
  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    startReply(msgEl);
    if (navigator.vibrate) navigator.vibrate(30);
  }, LONG_PRESS_MS);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((type) => {
  messagesEl.addEventListener(type, cancelLongPress, { passive: true });
});
