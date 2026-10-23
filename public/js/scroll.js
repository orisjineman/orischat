// 메시지 목록 스크롤: 맨 아래로 따라가기, ⬇ 버튼과 배지, "안 읽은 메시지" 구분선, 특정 메시지로 이동.
// 위로 스크롤해서 지난 메시지를 읽던 중이면 새 메시지가 와도 화면을 당기지 않고,
// 스크롤 버튼을 보여줘서 원할 때 이동하게 함.
import { NEAR_BOTTOM_THRESHOLD } from './constants.js';
import { messagesEl, scrollBottomBtn, scrollBottomCount } from './elements.js';
import { findMessageEl } from './messageElement.js';

export function isNearBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < NEAR_BOTTOM_THRESHOLD;
}

// 스크롤을 올려두고 읽는 동안 새로 온 (남의) 메시지 수 — ⬇ 버튼에 배지로 보여줌
let unreadBelow = 0;

function updateUnreadBadge() {
  scrollBottomCount.textContent = unreadBelow > 99 ? '99+' : String(unreadBelow);
  scrollBottomCount.classList.toggle('hidden', unreadBelow === 0);
}

export function resetUnreadBelow() {
  unreadBelow = 0;
  updateUnreadBadge();
}

// 위를 읽는 중에 새 메시지가 붙었을 때: 버튼을 보여주고, 남의 실시간 메시지면 배지 수를 올림
export function showNewBelow(countsAsUnread) {
  scrollBottomBtn.classList.remove('hidden');
  if (countsAsUnread) {
    unreadBelow += 1;
    updateUnreadBadge();
  }
}

function scrollToBottom(behavior = 'auto') {
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior });
  scrollBottomBtn.classList.add('hidden');
  resetUnreadBelow();
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

// --- 안 읽은 메시지 구분선 ---
export function createUnreadDivider() {
  const div = document.createElement('div');
  div.className = 'unread-divider';
  div.textContent = '여기서부터 안 읽은 메시지';
  return div;
}

function removeUnreadDivider() {
  messagesEl.querySelectorAll('.unread-divider').forEach((el) => el.remove());
}

// 다시 들어왔을 때: 마지막으로 본 시각 이후 남이 쓴 첫 메시지 앞에 구분선을 넣고 거기로 이동함
export function placeUnreadDivider(lastSeen) {
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

// 답장 인용 클릭 등: 원본 메시지로 스크롤하고 잠깐 강조함
export function scrollToMessage(messageId) {
  if (!messageId) return;
  const target = findMessageEl(messageId);
  if (!target) return; // "이전 메시지 더 보기"로 아직 안 불러온 경우 등 — 조용히 무시

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('flash-highlight');
  setTimeout(() => target.classList.remove('flash-highlight'), 1200);
}
