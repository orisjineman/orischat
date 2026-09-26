import { emojiPicker, gifBtn, gifGrid, gifPicker, gifSearchInput } from './elements.js';
import { sendChatMessage } from './compose.js';

// GIF 검색(GIPHY). 검색은 서버가 대신 해주고, 고른 GIF는 URL만 메시지로 보냄.
let debounceTimer = null;
let requestSeq = 0;

async function loadGifs(query) {
  const seq = ++requestSeq;
  gifGrid.textContent = '불러오는 중...';
  try {
    const res = await fetch(`/api/gifs?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(String(res.status));
    const list = await res.json();
    if (seq !== requestSeq) return; // 그 사이 더 새 검색이 시작됨
    if (!list.length) {
      gifGrid.textContent = '검색 결과가 없어요.';
      return;
    }
    gifGrid.textContent = '';
    for (const gif of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'gif-item';
      btn.dataset.url = gif.url;
      const img = document.createElement('img');
      img.src = gif.preview;
      img.alt = 'GIF';
      img.loading = 'lazy';
      btn.appendChild(img);
      gifGrid.appendChild(btn);
    }
  } catch {
    if (seq === requestSeq) gifGrid.textContent = 'GIF를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
  }
}

gifBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = gifPicker.classList.contains('hidden');
  gifPicker.classList.toggle('hidden');
  if (willOpen) {
    emojiPicker.classList.add('hidden');
    gifSearchInput.value = '';
    loadGifs('');
    gifSearchInput.focus();
  }
});

gifSearchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => loadGifs(gifSearchInput.value.trim()), 400);
});

gifGrid.addEventListener('click', (e) => {
  const item = e.target.closest('.gif-item');
  if (!item) return;
  sendChatMessage({ type: 'gif', content: item.dataset.url });
  gifPicker.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!gifPicker.classList.contains('hidden') && !gifPicker.contains(e.target) && e.target !== gifBtn) {
    gifPicker.classList.add('hidden');
  }
});
