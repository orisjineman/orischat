import { messageInput, replyBanner, replyBannerText, replyCancelBtn } from './elements.js';
import { state } from './state.js';

export function startReply(msgEl) {
  const nickname = msgEl.classList.contains('me') ? state.nickname : msgEl.querySelector('.msg-nick')?.textContent.trim() || '';
  const body = msgEl.querySelector('.msg-body');
  const isMedia = msgEl.querySelector('.sticker-img');
  const mediaLabel = msgEl.querySelector('.gif-img') ? 'GIF' : msgEl.querySelector('.chat-image') ? '사진' : '스티커';
  const preview = isMedia ? mediaLabel : (body ? body.textContent : '');

  state.pendingReplyTo = { id: msgEl.dataset.messageId, nickname, preview: preview.slice(0, 120) };
  replyBannerText.textContent = `${nickname}님에게 답장: ${state.pendingReplyTo.preview}`;
  replyBanner.classList.remove('hidden');
  messageInput.focus();
}

export function clearReply() {
  state.pendingReplyTo = null;
  replyBanner.classList.add('hidden');
}

replyCancelBtn.addEventListener('click', clearReply);
