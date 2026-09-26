import { searchBtn, searchCloseBtn, searchForm, searchInput, searchPanel, searchResults } from './elements.js';
import { jumpToMessage } from './messages.js';
import { socket } from './socket.js';
import { state } from './state.js';
import { formatTime, renderLinkedText } from './text.js';

// 방 안 메시지 검색
searchBtn.addEventListener('click', () => {
  searchPanel.classList.toggle('hidden');
  if (!searchPanel.classList.contains('hidden')) searchInput.focus();
});

searchCloseBtn.addEventListener('click', () => {
  searchPanel.classList.add('hidden');
});

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  searchResults.textContent = '검색 중...';
  socket.emit('search-messages', { query }, (results) => {
    if (!results || results.length === 0) {
      searchResults.textContent = '검색 결과가 없습니다.';
      return;
    }
    searchResults.innerHTML = '';
    results
      .slice()
      .reverse()
      .forEach((payload) => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.dataset.resultId = payload.id;
        item.dataset.time = payload.time;
        item.title = '클릭하면 이 메시지로 이동';
        const meta = document.createElement('div');
        meta.className = 'search-result-meta';
        meta.textContent = `${payload.nickname} · ${formatTime(payload.time)}`;
        const body = document.createElement('div');
        renderLinkedText(body, payload.content, state.roomUsers);
        item.appendChild(meta);
        item.appendChild(body);
        searchResults.appendChild(item);
      });
  });
});

// 검색 결과를 누르면 대화 속 그 메시지로 이동 (패널은 닫아서 대화가 보이게 함)
searchResults.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const item = e.target.closest('.search-result-item');
  if (!item) return;
  searchPanel.classList.add('hidden');
  jumpToMessage({ id: item.dataset.resultId, time: Number(item.dataset.time) });
});
