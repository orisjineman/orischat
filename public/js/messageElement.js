// 메시지 말풍선 하나의 DOM을 만들고 바꾸는 함수들 (목록에 붙이는 건 messages.js)
import { messagesEl } from './elements.js';
import { createAvatarEl } from './avatar.js';
import { endInlineEdit } from './inlineEdit.js';
import { attachLinkPreview } from './linkPreview.js';
import { renderReactions } from './reactions.js';
import { escapeHtml, formatTime, renderLinkedText } from './text.js';
import { state } from './state.js';

export function findMessageEl(messageId) {
  return messagesEl.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
}

// payload: { id, type, content, nickname, time, mine, reactions, deleted, replyTo, mentions, edited }
export function buildMessageEl({ id, type, content, message, nickname, time, mine, reactions, deleted, replyTo, edited }) {
  const div = document.createElement('div');
  // 구버전 서버 호환: type이 없으면 텍스트 메시지(message 필드)로 취급
  const kind = type || 'text';
  const text = content ?? message ?? '';

  div.className = `msg ${mine ? 'me' : 'other'} ${kind === 'sticker' || kind === 'image' || kind === 'gif' ? 'sticker' : ''}`;
  if (id) div.dataset.messageId = id;
  if (id && state.pinnedIds.has(id)) div.classList.add('pinned');
  if (time) div.dataset.time = time;

  const replyHtml = replyTo
    ? `<div class="reply-quote" data-reply-target="${escapeHtml(replyTo.id)}">↩ ${escapeHtml(
        replyTo.nickname
      )}: ${escapeHtml(replyTo.preview)}</div>`
    : '';

  div.innerHTML = `
    ${replyHtml}
    <div class="msg-body"></div>
    <div class="msg-footer">
      <span class="msg-time">${formatTime(time)}${edited ? ' (수정됨)' : ''}</span>
      ${mine && !deleted ? '<span class="read-status"></span>' : ''}
      ${id && !deleted ? '<button type="button" class="reply-btn" aria-label="답장">↩</button>' : ''}
      ${id && !deleted ? '<button type="button" class="react-btn" aria-label="반응 추가">🙂</button>' : ''}
      ${id && kind === 'text' && !deleted ? '<button type="button" class="copy-btn" aria-label="복사">📋</button>' : ''}
      ${id && !deleted ? '<button type="button" class="pin-btn" aria-label="고정/해제" title="고정/해제">📌</button>' : ''}
      ${id && mine && kind === 'text' && !deleted ? '<button type="button" class="edit-btn" aria-label="수정">✏️</button>' : ''}
      ${id && mine && !deleted ? '<button type="button" class="delete-btn" aria-label="삭제">🗑</button>' : ''}
    </div>
    <div class="msg-reactions"></div>
  `;

  if (!mine) {
    const nickDiv = document.createElement('div');
    nickDiv.className = 'msg-nick';
    nickDiv.appendChild(createAvatarEl(nickname));
    nickDiv.appendChild(document.createTextNode(nickname));
    div.insertBefore(nickDiv, div.firstChild);
  }

  const body = div.querySelector('.msg-body');
  if (deleted) {
    div.classList.add('deleted');
    body.textContent = '삭제된 메시지입니다';
  } else if (kind === 'sticker') {
    const img = document.createElement('img');
    img.src = `/stickers/${encodeURIComponent(text)}`;
    img.alt = '스티커';
    img.className = 'sticker-img';
    body.appendChild(img);
  } else if (kind === 'image') {
    const img = document.createElement('img');
    img.src = text;
    img.alt = '사진';
    img.className = 'sticker-img chat-image';
    body.appendChild(img);
  } else if (kind === 'gif') {
    const img = document.createElement('img');
    img.src = text;
    img.alt = 'GIF';
    img.className = 'sticker-img chat-image gif-img';
    body.appendChild(img);
  } else {
    renderLinkedText(body, text, state.roomUsers);
    attachLinkPreview(div, text);
  }

  if (reactions && !deleted) {
    renderReactions(div.querySelector('.msg-reactions'), reactions);
  }

  return div;
}

export function applyDeletedState(msgEl) {
  msgEl.classList.add('deleted');
  const body = msgEl.querySelector('.msg-body');
  if (body) body.textContent = '삭제된 메시지입니다';
  const reactionsEl = msgEl.querySelector('.msg-reactions');
  if (reactionsEl) reactionsEl.innerHTML = '';
  endInlineEdit(msgEl);
  msgEl.querySelector('.link-card')?.remove();
  ['.react-btn', '.delete-btn', '.reply-btn', '.edit-btn', '.copy-btn', '.pin-btn'].forEach((sel) => {
    const el = msgEl.querySelector(sel);
    if (el) el.remove();
  });
}
