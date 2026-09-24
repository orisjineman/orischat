import { HISTORY_PAGE_SIZE, NEAR_BOTTOM_THRESHOLD } from './constants.js';
import { messagesEl, scrollBottomBtn, typingIndicator } from './elements.js';
import { clearHistory, loadHistory, saveToHistory, updateHistoryEntry } from './historyStore.js';
import { createAvatarEl } from './avatar.js';
import { openLightbox } from './lightbox.js';
import { maybeNotify } from './notifications.js';
import { maybeMarkRead } from './read.js';
import { openReactionPopup, renderReactions, sendReaction } from './reactions.js';
import { startReply } from './reply.js';
import { socket } from './socket.js';
import { escapeHtml, formatTime, renderLinkedText } from './text.js';
import { state } from './state.js';

function findMessageEl(messageId) {
  return messagesEl.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
}

// --- 메시지 렌더링 ---
// payload: { id, type, content, nickname, time, mine, reactions, deleted, replyTo, mentions, edited }
function buildMessageEl({ id, type, content, message, nickname, time, mine, reactions, deleted, replyTo, edited }) {
  const div = document.createElement('div');
  // 구버전 서버 호환: type이 없으면 텍스트 메시지(message 필드)로 취급
  const kind = type || 'text';
  const text = content ?? message ?? '';

  div.className = `msg ${mine ? 'me' : 'other'} ${kind === 'sticker' || kind === 'image' ? 'sticker' : ''}`;
  if (id) div.dataset.messageId = id;
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
  } else {
    renderLinkedText(body, text, state.roomUsers);
  }

  if (reactions && !deleted) {
    renderReactions(div.querySelector('.msg-reactions'), reactions);
  }

  return div;
}

function applyDeletedState(msgEl) {
  msgEl.classList.add('deleted');
  const body = msgEl.querySelector('.msg-body');
  if (body) body.textContent = '삭제된 메시지입니다';
  const reactionsEl = msgEl.querySelector('.msg-reactions');
  if (reactionsEl) reactionsEl.innerHTML = '';
  ['.react-btn', '.delete-btn', '.reply-btn', '.edit-btn'].forEach((sel) => {
    const el = msgEl.querySelector(sel);
    if (el) el.remove();
  });
}

// --- 스크롤 ---
// 위로 스크롤해서 지난 메시지를 읽던 중이면 새 메시지가 와도 화면을 당기지 않고,
// 스크롤 버튼을 보여줘서 원할 때 이동하게 함.
function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < NEAR_BOTTOM_THRESHOLD;
}

function scrollToBottom(behavior = 'auto') {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
  scrollBottomBtn.classList.add('hidden');
}

function appendMessage(payload) {
  const wasNearBottom = isNearBottom();
  const div = buildMessageEl(payload);
  messagesEl.appendChild(div);
  if (wasNearBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else {
    scrollBottomBtn.classList.remove('hidden');
  }
}

function appendSystemMessage(text) {
  const wasNearBottom = isNearBottom();
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  messagesEl.appendChild(div);
  if (wasNearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

scrollBottomBtn.addEventListener('click', () => scrollToBottom('smooth'));

// 위로 스크롤해서 지난 대화를 보고 있으면 버튼을 보여주고, 맨 아래 근처로
// 돌아오면 다시 숨김 — 새 메시지가 왔을 때뿐 아니라 언제든 쓸 수 있게 함
messagesEl.addEventListener('scroll', () => {
  const scrollable = messagesEl.scrollHeight > messagesEl.clientHeight + NEAR_BOTTOM_THRESHOLD;
  scrollBottomBtn.classList.toggle('hidden', !scrollable || isNearBottom());
});

// 답장 인용 클릭 시 원본 메시지로 스크롤
function scrollToMessage(messageId) {
  if (!messageId) return;
  const target = findMessageEl(messageId);
  if (!target) return; // "이전 메시지 더 보기"로 아직 안 불러온 경우 등 — 조용히 무시

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('flash-highlight');
  setTimeout(() => target.classList.remove('flash-highlight'), 1200);
}

// --- 메시지 안의 버튼/링크 클릭 (이벤트 위임) ---
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

  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    const msgEl = editBtn.closest('.msg');
    const body = msgEl.querySelector('.msg-body');
    const newText = prompt('메시지 수정', body ? body.textContent : '');
    if (newText != null && newText.trim() && newText.trim() !== (body ? body.textContent : '')) {
      socket.emit('edit-message', { messageId: msgEl.dataset.messageId, content: newText.trim() });
    }
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
  }
});

// --- 이전 메시지 더 보기(페이지네이션) ---
const loadMoreBtn = document.createElement('button');
loadMoreBtn.type = 'button';
loadMoreBtn.id = 'load-more-btn';
loadMoreBtn.textContent = '이전 메시지 더 보기';
loadMoreBtn.classList.add('hidden');
messagesEl.insertAdjacentElement('beforebegin', loadMoreBtn);

function prependMessages(list) {
  const prevHeight = messagesEl.scrollHeight;
  const prevTop = messagesEl.scrollTop;
  const frag = document.createDocumentFragment();
  list.forEach((payload) => frag.appendChild(buildMessageEl(payload)));
  messagesEl.insertBefore(frag, messagesEl.firstChild);
  messagesEl.scrollTop = prevTop + (messagesEl.scrollHeight - prevHeight);
}

loadMoreBtn.addEventListener('click', () => {
  if (!state.oldestMessageTime) return;
  loadMoreBtn.disabled = true;
  loadMoreBtn.textContent = '불러오는 중...';
  socket.emit('load-more', { beforeTime: state.oldestMessageTime }, (older) => {
    loadMoreBtn.disabled = false;
    loadMoreBtn.textContent = '이전 메시지 더 보기';
    if (!older || older.length === 0) {
      loadMoreBtn.classList.add('hidden');
      return;
    }
    prependMessages(older);
    state.oldestMessageTime = older[0].time;
    if (older.length < HISTORY_PAGE_SIZE) {
      loadMoreBtn.classList.add('hidden');
    }
  });
});

// 새로고침 시 sessionStorage에 저장해둔 이전 대화를 먼저 복원
loadHistory().forEach((entry) => {
  if (entry.kind === 'chat') appendMessage(entry.payload);
  else if (entry.kind === 'system') appendSystemMessage(entry.text);
});

// --- 서버 이벤트 ---
socket.on('chat-message', (payload) => {
  appendMessage(payload);
  saveToHistory({ kind: 'chat', payload });
  maybeNotify(payload);
  if (payload.time > state.latestMessageTime) state.latestMessageTime = payload.time;
  maybeMarkRead();
});

// 서버가 DB에서 불러온 진짜 대화 기록(최근 페이지 하나 분량). sessionStorage
// 캐시(새로고침 전까지의 임시 복원용)를 서버가 알려주는 정확한 내용으로 교체함
// — 이렇게 하면 새로 들어온 사람도 지난 대화를 볼 수 있고, 중복 표시도 안 생김.
socket.on('history', (messages) => {
  messagesEl.innerHTML = '';
  clearHistory();
  messages.forEach((payload) => {
    appendMessage(payload);
    saveToHistory({ kind: 'chat', payload });
  });
  state.oldestMessageTime = messages.length ? messages[0].time : null;
  if (messages.length) state.latestMessageTime = messages[messages.length - 1].time;
  maybeMarkRead();
  loadMoreBtn.classList.toggle('hidden', messages.length < HISTORY_PAGE_SIZE);
});

socket.on('system-message', (text) => {
  appendSystemMessage(text);
  saveToHistory({ kind: 'system', text });
});

socket.on('typing', ({ nickname, isTyping }) => {
  typingIndicator.textContent = isTyping ? `${nickname}님이 입력 중...` : '';
});

socket.on('message-edited', ({ messageId, content, editedAt }) => {
  const msgEl = findMessageEl(messageId);
  if (msgEl) {
    renderLinkedText(msgEl.querySelector('.msg-body'), content, state.roomUsers);
    const timeEl = msgEl.querySelector('.msg-time');
    if (timeEl && !timeEl.textContent.includes('(수정됨)')) timeEl.textContent += ' (수정됨)';
  }
  updateHistoryEntry(messageId, (p) => {
    p.content = content;
    p.edited = true;
  });
});

socket.on('reaction-update', ({ messageId, reactions }) => {
  const msgEl = findMessageEl(messageId);
  if (msgEl) {
    renderReactions(msgEl.querySelector('.msg-reactions'), reactions);
  }
  updateHistoryEntry(messageId, (p) => {
    p.reactions = reactions;
  });
});

socket.on('message-deleted', ({ messageId }) => {
  const msgEl = findMessageEl(messageId);
  if (msgEl) applyDeletedState(msgEl);
  updateHistoryEntry(messageId, (p) => {
    p.deleted = true;
  });
});
