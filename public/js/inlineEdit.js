// 인라인 수정: 말풍선 자리에서 바로 고침 (Enter 저장 / Esc 취소)
import { messagesEl } from './elements.js';
import { socket } from './socket.js';

export function endInlineEdit(msgEl) {
  const editor = msgEl.querySelector('.inline-edit');
  if (!editor) return;
  editor.remove();
  const body = msgEl.querySelector('.msg-body');
  if (body) body.hidden = false;
  msgEl.classList.remove('editing');
}

export function startInlineEdit(msgEl) {
  const body = msgEl && msgEl.querySelector('.msg-body');
  if (!body || msgEl.classList.contains('deleted') || msgEl.querySelector('.inline-edit')) return;
  messagesEl.querySelectorAll('.msg.editing').forEach(endInlineEdit); // 한 번에 하나만

  const original = body.textContent;
  const editor = document.createElement('div');
  editor.className = 'inline-edit';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit-input';
  input.maxLength = 500;
  input.value = original;
  input.setAttribute('aria-label', '메시지 수정');

  const actions = document.createElement('div');
  actions.className = 'inline-edit-actions';
  const hint = document.createElement('span');
  hint.className = 'inline-edit-hint';
  hint.textContent = 'Enter 저장 · Esc 취소';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'inline-edit-save';
  saveBtn.textContent = '저장';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'inline-edit-cancel';
  cancelBtn.textContent = '취소';
  actions.append(hint, cancelBtn, saveBtn);
  editor.append(input, actions);

  const save = () => {
    const value = input.value.trim();
    endInlineEdit(msgEl);
    if (value && value !== original) socket.emit('edit-message', { messageId: msgEl.dataset.messageId, content: value });
  };
  saveBtn.addEventListener('click', save);
  cancelBtn.addEventListener('click', () => endInlineEdit(msgEl));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중 Enter는 조합 확정
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      endInlineEdit(msgEl);
    }
  });

  body.hidden = true;
  body.after(editor);
  msgEl.classList.add('editing');
  msgEl.classList.remove('actions-open');
  msgEl.scrollIntoView({ block: 'nearest' });
  input.focus();
  input.setSelectionRange(original.length, original.length);
}
