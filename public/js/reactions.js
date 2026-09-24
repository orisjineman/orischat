import { socket } from './socket.js';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const reactionPopup = document.createElement('div');
reactionPopup.id = 'reaction-popup';
reactionPopup.className = 'hidden';
reactionPopup.innerHTML = QUICK_REACTIONS.map((e) => `<button type="button" class="reaction-pick">${e}</button>`).join('');
document.body.appendChild(reactionPopup);
let reactionPopupTarget = null;

// 서버가 보내주는 reactions 형식: { emoji: { count, mine } } — mine은 "나도 눌렀는지"
export function renderReactions(container, reactionsObj) {
  container.innerHTML = '';
  Object.entries(reactionsObj || {}).forEach(([emoji, info]) => {
    if (!info || !info.count) return;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'reaction-pill' + (info.mine ? ' mine' : '');
    pill.dataset.emoji = emoji;
    pill.textContent = `${emoji} ${info.count}`;
    container.appendChild(pill);
  });
}

export function sendReaction(messageId, emoji) {
  if (!messageId) return;
  socket.emit('react', { messageId, emoji });
}

export function openReactionPopup(anchorEl, messageId) {
  reactionPopupTarget = messageId;
  reactionPopup.classList.remove('hidden');

  const rect = anchorEl.getBoundingClientRect();
  const popupWidth = reactionPopup.offsetWidth;
  // 화면 오른쪽/왼쪽 경계를 넘지 않도록 보정
  let left = rect.left + window.scrollX - popupWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));

  reactionPopup.style.top = `${rect.top + window.scrollY - 44}px`;
  reactionPopup.style.left = `${left}px`;
}

reactionPopup.addEventListener('click', (e) => {
  const btn = e.target.closest('.reaction-pick');
  if (btn && reactionPopupTarget) {
    sendReaction(reactionPopupTarget, btn.textContent);
  }
  reactionPopup.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!reactionPopup.classList.contains('hidden') && !reactionPopup.contains(e.target) && !e.target.closest('.react-btn')) {
    reactionPopup.classList.add('hidden');
  }
});
