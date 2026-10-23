// 메시지 목록: 붙이기/앞에 끼워넣기, 날짜 구분선, 이전 메시지 더 보기, 검색 결과로 이동,
// 그리고 메시지 관련 서버 이벤트 처리. 말풍선 하나의 DOM은 messageElement.js,
// 스크롤·구분선은 scroll.js, 클릭/길게 누르기는 messageInteractions.js에 있음.
import { HISTORY_PAGE_SIZE } from './constants.js';
import { messagesEl, typingIndicator } from './elements.js';
import { getLastSeen } from './lastSeen.js';
import { clearHistory, loadHistory, saveToHistory, updateHistoryEntry } from './historyStore.js';
import { endInlineEdit } from './inlineEdit.js';
import { attachLinkPreview } from './linkPreview.js';
import { applyDeletedState, buildMessageEl, findMessageEl } from './messageElement.js';
import './messageInteractions.js';
import { showToast } from './toast.js';
import { maybeNotify } from './notifications.js';
import { maybeMarkRead } from './read.js';
import { renderReactions } from './reactions.js';
import {
  createUnreadDivider,
  isNearBottom,
  placeUnreadDivider,
  resetUnreadBelow,
  scrollToMessage,
  showNewBelow,
} from './scroll.js';
import { socket } from './socket.js';
import { formatDateLabel, isSameDay, renderLinkedText } from './text.js';
import { bumpTitleUnread } from './unread.js';
import { state } from './state.js';

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
    showNewBelow(!payload.mine && !payload.isHistory);
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
    endInlineEdit(msgEl);
    renderLinkedText(msgEl.querySelector('.msg-body'), content, state.roomUsers);
    attachLinkPreview(msgEl, content);
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
