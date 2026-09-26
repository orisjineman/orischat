import { socket } from './socket.js';
import { state } from './state.js';

// 메시지 속 첫 번째 링크의 미리보기 카드(제목/설명/썸네일). 서버가 대신 페이지를 열어
// 가져오고(내부망 접근 차단 등은 서버에서 처리), 브라우저는 외부 사이트에 직접 접속하지 않음.
const URL_RE = /https?:\/\/[^\s]+/;
const MAX_ACTIVE = 2;
const REQUEST_TIMEOUT_MS = 12000;
const THUMB_PREFIX = 'data:image/jpeg;base64,';

const cache = new Map(); // url -> 미리보기 객체 | false(없음)  (null=거절됨은 저장 안 함)
const pending = new Map(); // url -> Promise
const queue = [];
let active = 0;

function pump() {
  if (!state.hasJoined) return; // 입장하기 전에 보내면 서버가 거절함
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active += 1;
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      active -= 1;
      pending.delete(job.url);
      if (res === false || (res && typeof res === 'object')) cache.set(job.url, res);
      job.resolve(res || null);
      pump();
    };
    setTimeout(() => finish(null), REQUEST_TIMEOUT_MS);
    socket.emit('link-preview', { url: job.url }, finish);
  }
}

// 방에 입장한 직후에 밀려 있던 요청을 처리함 (login.js가 hasJoined를 먼저 갱신하도록 한 틱 뒤에)
socket.on('joined', () => setTimeout(pump, 0));

function fetchPreview(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (pending.has(url)) return pending.get(url);
  const promise = new Promise((resolve) => {
    queue.push({ url, resolve });
    pump();
  });
  pending.set(url, promise);
  return promise;
}

// "https://a.com/x)." 처럼 문장부호가 붙어 있으면 떼어냄
function firstUrl(text) {
  const m = URL_RE.exec(text || '');
  return m ? m[0].replace(/[.,!?;:)\]}'"]+$/, '') : null;
}

function buildCard(url, p) {
  const card = document.createElement('a');
  card.className = 'link-card';
  card.href = url;
  card.target = '_blank';
  card.rel = 'noopener noreferrer';

  if (typeof p.image === 'string' && p.image.startsWith(THUMB_PREFIX)) {
    const img = document.createElement('img');
    img.className = 'link-card-thumb';
    img.src = p.image;
    img.alt = '';
    card.appendChild(img);
  }

  const text = document.createElement('div');
  text.className = 'link-card-text';
  const parts = [
    ['link-card-site', p.siteName],
    ['link-card-title', p.title],
    ['link-card-desc', p.description],
  ];
  for (const [cls, value] of parts) {
    if (!value) continue;
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = value; // 텍스트로만 넣음 (HTML로 해석되지 않게)
    text.appendChild(el);
  }
  card.appendChild(text);
  return card;
}

// 메시지 말풍선(msgEl)에 미리보기 카드를 붙임. 링크가 없거나 미리보기를 못 만들면 아무것도 안 함.
export async function attachLinkPreview(msgEl, text) {
  msgEl.querySelector('.link-card')?.remove();
  const url = firstUrl(text);
  if (!url) return;

  const preview = await fetchPreview(url);
  if (!preview || msgEl.querySelector('.link-card') || msgEl.classList.contains('deleted')) return;
  if (firstUrl(msgEl.querySelector('.msg-body')?.textContent) !== url) return; // 그 사이 수정되어 링크가 바뀜
  msgEl.querySelector('.msg-body')?.after(buildCard(url, preview));
}
