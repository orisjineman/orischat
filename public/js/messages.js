import { HISTORY_PAGE_SIZE, NEAR_BOTTOM_THRESHOLD } from './constants.js';
import { messagesEl, scrollBottomBtn, scrollBottomCount, typingIndicator } from './elements.js';
import { getLastSeen } from './lastSeen.js';
import { clearHistory, loadHistory, saveToHistory, updateHistoryEntry } from './historyStore.js';
import { createAvatarEl } from './avatar.js';
import { openLightbox } from './lightbox.js';
import { showToast } from './toast.js';
import { maybeNotify } from './notifications.js';
import { maybeMarkRead } from './read.js';
import { openReactionPopup, renderReactions, sendReaction } from './reactions.js';
import { startReply } from './reply.js';
import { socket } from './socket.js';
import { escapeHtml, formatDateLabel, formatTime, isSameDay, renderLinkedText } from './text.js';
import { bumpTitleUnread } from './unread.js';
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

  div.className = `msg ${mine ? 'me' : 'other'} ${kind === 'sticker' || kind === 'image' || kind === 'gif' ? 'sticker' : ''}`;
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
      ${id && kind === 'text' && !deleted ? '<button type="button" class="copy-btn" aria-label="복사">📋</button>' : ''}
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
  ['.react-btn', '.delete-btn', '.reply-btn', '.edit-btn', '.copy-btn'].forEach((sel) => {
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

// 스크롤을 올려두고 읽는 동안 새로 온 (남의) 메시지 수 — ⬇ 버튼에 배지로 보여줌
let unreadBelow = 0;

function updateUnreadBadge() {
  scrollBottomCount.textContent = unreadBelow > 99 ? '99+' : String(unreadBelow);
  scrollBottomCount.classList.toggle('hidden', unreadBelow === 0);
}

function resetUnreadBelow() {
  unreadBelow = 0;
  updateUnreadBadge();
}

function scrollToBottom(behavior = 'auto') {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
  scrollBottomBtn.classList.add('hidden');
  resetUnreadBelow();
}

// --- 안 읽은 메시지 구분선 ---
function createUnreadDivider() {
  const div = document.createElement('div');
  div.className = 'unread-divider';
  div.textContent = '여기서부터 안 읽은 메시지';
  return div;
}

function removeUnreadDivider() {
  messagesEl.querySelectorAll('.unread-divider').forEach((el) => el.remove());
}

// 다시 들어왔을 때: 마지막으로 본 시각 이후 남이 쓴 첫 메시지 앞에 구분선을 넣고 거기로 이동함
function placeUnreadDivider(lastSeen) {
  removeUnreadDivider();
  if (!lastSeen) return;
  const unread = Array.from(messagesEl.querySelectorAll('.msg.other[data-time]')).filter((el) => Number(el.dataset.time) > lastSeen);
  if (!unread.length) return;
  const divider = createUnreadDivider();
  unread[0].before(divider);
  divider.scrollIntoView({ block: 'start' });
  unreadBelow = unread.length;
  updateUnreadBadge();
  scrollBottomBtn.classList.remove('hidden');
}

// 탭을 떠나는 순간 구분선을 치워둠 — 그래야 자리를 비운 사이 온 메시지 앞에 새로 생김
document.addEventListener('visibilitychange', () => {
  if (document.hidden) removeUnreadDivider();
});

// --- 날짜 구분선 ---
function createDateDivider(time) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  div.textContent = formatDateLabel(time);
  return div;
}

function lastTimedMessageEl() {
  for (let el = messagesEl.lastElementChild; el; el = el.previousElementSibling) {
    if (el.dataset && el.dataset.time) return el;
  }
  return null;
}

// 위쪽에 이전 메시지를 붙인 뒤에는 구분선을 통째로 다시 계산함
function rebuildDateDividers() {
  messagesEl.querySelectorAll('.date-divider').forEach((el) => el.remove());
  let prevTime = null;
  Array.from(messagesEl.querySelectorAll('.msg[data-time]')).forEach((el) => {
    const t = Number(el.dataset.time);
    if (prevTime === null || !isSameDay(prevTime, t)) el.before(createDateDivider(t));
    prevTime = t;
  });
}

function appendMessage(payload) {
  const wasNearBottom = isNearBottom();
  const div = buildMessageEl(payload);
  if (payload.time) {
    const prev = lastTimedMessageEl();
    if (!prev || !isSameDay(Number(prev.dataset.time), payload.time)) messagesEl.appendChild(createDateDivider(payload.time));
  }
  messagesEl.appendChild(div);
  // 내가 방금 보낸 메시지는 위를 읽던 중이어도 바로 보이게 맨 아래로 따라감
  const justSentByMe = payload.mine && !payload.isHistory;
  if (wasNearBottom || justSentByMe) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (justSentByMe) resetUnreadBelow();
  } else {
    scrollBottomBtn.classList.remove('hidden');
    if (!payload.mine && !payload.isHistory) {
      unreadBelow += 1;
      updateUnreadBadge();
    }
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
  const near = isNearBottom();
  scrollBottomBtn.classList.toggle('hidden', !scrollable || near);
  if (near) resetUnreadBelow();
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

// 검색 결과에서 클릭했을 때: 이미 화면에 있으면 바로 이동하고, 더 오래된 메시지면
// 화면의 가장 오래된 메시지까지 한 번에 불러온 뒤 이동함
export function jumpToMessage({ id, time }) {
  if (findMessageEl(id)) {
    scrollToMessage(id);
    return;
  }
  if (!state.oldestMessageTime || !time || time >= state.oldestMessageTime) {
    showToast('메시지를 찾을 수 없어요', 2500);
    return;
  }
  socket.emit('load-until', { fromTime: time, beforeTime: state.oldestMessageTime }, (older) => {
    if (!older || older.length === 0) {
      showToast('메시지를 찾을 수 없어요', 2500);
      return;
    }
    prependMessages(older);
    state.oldestMessageTime = older[0].time;
    loadMoreBtn.classList.remove('hidden');
    if (findMessageEl(id)) scrollToMessage(id);
    else showToast('너무 오래된 메시지예요. "이전 메시지 더 보기"로 더 불러와주세요', 3500);
  });
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

  const copyBtn = e.target.closest('.copy-btn');
  if (copyBtn) {
    const body = copyBtn.closest('.msg').querySelector('.msg-body');
    copyText(body ? body.textContent : '');
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
    return;
  }

  // 그 밖에 말풍선을 탭하면 액션 버튼(답장/반응/복사...)을 펼치거나 접음 (터치 기기용)
  if (e.target.closest('a, .avatar-clickable')) return;
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
  if (!msgEl || !msgEl.dataset.messageId || e.target.closest('button, a, img')) return;
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
  rebuildDateDividers();
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
  if (entry.kind === 'chat') appendMessage({ ...entry.payload, isHistory: true });
  else if (entry.kind === 'system') appendSystemMessage(entry.text);
});

// --- 서버 이벤트 ---
socket.on('chat-message', (payload) => {
  // 탭이 가려진 사이 처음 온 남의 메시지 앞에 "안 읽은 메시지" 구분선을 넣음
  const startsUnread = document.hidden && !payload.mine && !messagesEl.querySelector('.unread-divider');
  appendMessage(payload);
  if (startsUnread) messagesEl.lastElementChild.before(createUnreadDivider());
  if (!payload.mine) bumpTitleUnread();
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
  resetUnreadBelow();
  const lastSeen = getLastSeen(state.room); // maybeMarkRead가 갱신하기 전에 읽어둠
  messages.forEach((payload) => {
    appendMessage({ ...payload, isHistory: true });
    saveToHistory({ kind: 'chat', payload });
  });
  state.oldestMessageTime = messages.length ? messages[0].time : null;
  if (messages.length) state.latestMessageTime = messages[messages.length - 1].time;
  placeUnreadDivider(lastSeen);
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
