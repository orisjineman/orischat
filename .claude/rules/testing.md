---
paths:
  - "test/**"
---

# 테스트 작성 규칙

- `node --test`는 파일마다 별도 프로세스 → 모듈을 불러오는 시점에 정해지는 설정(DB 켬/끔, `CHAT_PIN`, VAPID, GIPHY)은
  **파일을 나눠서** 테스트함. 기존 모드의 파일이 있으면 거기에 추가하고, 새 모드가 필요할 때만 새 파일을 만듦.
- 환경 변수는 반드시 `require('../server')`·`require('../db')` **전에** 설정.
  DB 모드는 `fs.mkdtempSync`로 임시 폴더를 만들고 `process.env.TURSO_DATABASE_URL = 'file:<tmp>/test.db'` (`chat-db.test.js` 참고).
- 서버 통합 테스트: `before`에서 `start(0)`으로 임의 포트에 띄우고 `setBaseUrl()`, 소켓은 `test/helpers/socket-harness.js`의
  `connectClient` / `join` / `waitFor` / `collectDuring` / `withClients`를 사용. 끝나면 `closeClient`로 정리.
- "오지 않아야 하는 이벤트"는 `collectDuring`으로 일정 시간 모아서 비었는지 확인.
- 외부 서비스는 실제로 호출하지 않음: web-push → `helpers/fake-webpush.js`, GIPHY·링크 미리보기 → 테스트 안에서 띄운 로컬 HTTP 서버.
  링크 미리보기 테스트는 로컬 주소를 써야 해서 `LINK_PREVIEW_ALLOW_PRIVATE=1`을 켬.
- 푸시처럼 메모리/DB 두 저장 경로가 있는 기능은 `helpers/push-scenarios.js`처럼 시나리오를 공유해서 두 모드에 같은 테스트를 돌림.
- 클라이언트 테스트(`client.test.js`)는 실제 `public/index.html`을 jsdom에 올리고 가짜 소켓으로 서버 이벤트를 흉내냄.
- `assert`는 `node:assert/strict`. 테스트 이름과 실패 메시지는 한국어.
- 기능을 바꾸면 해당 테스트를 같이 추가/수정하고 `npm test` 전체 통과를 확인할 것.
