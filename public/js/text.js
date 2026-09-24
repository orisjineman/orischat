export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// 닉네임마다 고정된 색을 만들어줌 (아바타 배경색). 같은 닉네임이면 항상 같은 색.
export function nicknameColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 60%, 45%)`;
}

export function nicknameInitial(name) {
  const chars = Array.from(name || '?');
  return (chars[0] || '?').toUpperCase();
}

// 메시지 안의 http(s):// 링크는 클릭 가능한 <a>로, "@닉네임"(현재 방에 있는
// 사람만)은 하이라이트로 바꿔줌. 그 외 텍스트는 그대로 텍스트 노드라 escape됨.
export function renderLinkedText(container, text, mentionNames = []) {
  container.textContent = '';

  // 닉네임이 다른 닉네임의 앞부분과 겹칠 수 있어서(예: "김"과 "김철수"), 긴
  // 것부터 매칭되도록 길이 내림차순으로 정렬함.
  const names = Array.from(new Set(mentionNames)).filter(Boolean).sort((a, b) => b.length - a.length);
  const mentionAlternation = names.map((n) => `@${escapeRegExp(n)}`).join('|');
  const pattern = mentionAlternation
    ? new RegExp(`(https?:\\/\\/[^\\s]+)|(${mentionAlternation})`, 'g')
    : /(https?:\/\/[^\s]+)/g;

  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    if (match[1]) {
      const a = document.createElement('a');
      a.href = match[1];
      a.textContent = match[1];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      container.appendChild(a);
    } else if (match[2]) {
      const span = document.createElement('span');
      span.className = 'mention';
      span.textContent = match[2];
      container.appendChild(span);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}
