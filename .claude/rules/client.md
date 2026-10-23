---
paths:
  - "public/**"
---

# 프론트엔드(public/) 규칙

- 번들러·프레임워크 없이 브라우저 네이티브 ES 모듈. import 경로에 `.js` 확장자를 꼭 붙임. npm 패키지는 쓸 수 없음
  (Socket.IO 클라이언트는 `/socket.io/socket.io.js`가 주는 전역 `io`를 `js/socket.js`에서만 사용).
- 기능별 모듈은 `public/js/<기능>.js`에 두고, import되는 순간 자기 DOM·소켓 이벤트를 등록함. 새 모듈은 `public/client.js`에 import 추가.
- 모듈 간 공유 상태는 `js/state.js`의 `state` 객체(let export는 다른 모듈에서 재할당 불가), DOM 참조는 `js/elements.js`에 모음.
- 사용자 입력·다른 사람 메시지를 HTML에 넣을 때는 `js/text.js`의 `escapeHtml` / `renderLinkedText`를 거침.
- 상한값(`js/constants.js`)은 서버 `lib/config.js`와 같은 값이어야 함 — 한쪽을 바꾸면 다른 쪽도.
- 저장소 키는 `constants.js`의 `orischat-*` 키 사용. 탭 단위로 유지할 값(닉네임·PIN·방·대화 캐시)은 sessionStorage,
  기기에 남길 값(clientId·테마·마지막 읽은 시각)은 localStorage.
- `clientId`는 서버에만 보냄. 다른 사람 메시지가 "내 것"인지는 서버가 내려주는 `mine`으로만 판단.
- 색은 하드코딩하지 말고 `style.css`의 CSS 변수 사용 — 테마(light/dark/intellij/excel/claude/claude-dark)마다 변수가 재정의됨.
  새 테마는 `:root[data-theme="<값>"]` 블록 + `js/theme.js` 목록에 추가.
- 모바일(PWA) 화면이 주 사용 환경이므로 좁은 폭에서도 확인할 것.
