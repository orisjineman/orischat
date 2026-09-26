// 탭이 가려져 있는 동안 온 새 메시지 수를 탭 제목에 "(3) OrisChat"처럼 보여줌.
const BASE_TITLE = document.title;
let count = 0;

export function bumpTitleUnread() {
  if (!document.hidden) return;
  count += 1;
  document.title = `(${count}) ${BASE_TITLE}`;
}

function reset() {
  count = 0;
  document.title = BASE_TITLE;
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reset();
});
window.addEventListener('focus', reset);
