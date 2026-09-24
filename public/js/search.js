import { searchBtn, searchCloseBtn, searchForm, searchInput, searchPanel, searchResults } from './elements.js';
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
