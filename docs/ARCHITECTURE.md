# OrisChat 아키텍처

## 한눈에 보기

```
 브라우저 (public/)                               서버 (Node.js)                         외부 (모두 선택)
┌──────────────────────────┐   HTTP (정적/API)   ┌──────────────────────────────┐
│ index.html + style.css   │ ──────────────────▶ │ Express                      │ ──▶ GIPHY API (/api/gifs 프록시)
│ client.js → js/*.js      │                     │  routes / gifs / stickers    │ ──▶ 임의 웹페이지 (링크 미리보기)
│ (ES 모듈, 번들러 없음)    │   WebSocket         │                              │
│                          │ ◀─────────────────▶ │ Socket.IO                    │
│ service-worker.js ◀──────┼── Web Push ─────────│  handlers/* (이벤트별)        │ ──▶ Turso / libSQL (db.js)
└──────────────────────────┘                     │  state.js (메모리 실시간 상태) │ ──▶ Web Push 서비스 (push.js)
                                                 └──────────────────────────────┘
```

- 서버 하나(`server.js`)가 정적 파일, HTTP API, Socket.IO를 모두 담당.
- 실시간 기능은 전부 Socket.IO 이벤트, HTTP는 설정 조회·이미지 서빙·GIF 검색 프록시 정도만.
- 외부 의존(Turso, VAPID, GIPHY)은 전부 선택 사항. 없으면 메모리 폴백이나 기능 비활성화로 동작.

## 폴더 구조

```
orischat/
├── server.js                  # 진입점: Express + Socket.IO 조립, DB init, 7일 정리 타이머, start(port)
├── db.js                      # 저장소 파사드 — lib/db/* 를 모아 하나의 객체로 내보냄 (enabled 플래그 포함)
├── push.js                    # Web Push: VAPID 설정, 구독/해지, 방 단위 알림 발송 (본문 미포함)
├── package.json               # 스크립트: start / dev / test
├── render.yaml                # Render 배포 설정 (free plan)
├── deploy.sh                  # 맥 로컬(launchctl) 서버용 배포 스크립트
├── CLAUDE.md                  # Claude Code 작업 가이드 (이 문서를 @import)
├── .claude/rules/             # 경로별 Claude 규칙: testing.md(test/**), client.md(public/**)
├── README.md                  # 사용자용 설명 (기능, 환경 변수, 한계)
│
├── lib/                       # 서버 내부 모듈 (CommonJS)
│   ├── config.js              #   상수·환경 변수·입력 길이 상한(MAX)·경로
│   ├── state.js               #   메모리 실시간 상태: 접속자, 메시지 작성자 캐시, 읽음 위치, 멘션 감지
│   ├── emitters.js            #   방 전송 헬퍼: emitPersonalized, 접속자 목록, 읽음, 고정 목록
│   ├── present.js             #   "보는 사람 기준" 변환 (clientId → mine), 미리보기 문자열
│   ├── validation.js          #   순수 검증 함수 (이미지 data URL, GIPHY CDN URL)
│   ├── rateLimiter.js         #   이벤트별 sliding-window 도배 방지
│   ├── store.js               #   리액션·프로필 사진 저장소 (DB ↔ 메모리 폴백)
│   ├── pinStore.js            #   고정 메시지 저장소 (DB ↔ 메모리 폴백)
│   ├── pushSubscriptions.js   #   푸시 구독 저장소 (DB ↔ 메모리 폴백)
│   ├── routes.js              #   HTTP: /api/config, /api/rooms, /avatar/:nickname
│   ├── gifs.js                #   HTTP: /api/gifs — GIPHY 검색 프록시 + 짧은 캐시
│   ├── stickers.js            #   HTTP: /api/stickers, /stickers/:file — 큰 이미지는 sharp로 축소·캐시
│   ├── linkPreview.js         #   OpenGraph 파싱, 썸네일 변환, SSRF 방어, 1시간 캐시
│   │
│   ├── db/                    #   테이블별 DB 모듈 (Turso/libSQL)
│   │   ├── client.js          #     연결, query/run/transaction, whenEnabled 래퍼
│   │   ├── schema.js          #     CREATE TABLE IF NOT EXISTS + ensureColumn 마이그레이션
│   │   ├── messages.js        #     메시지 CRUD, 페이지네이션, 검색, 7일 정리
│   │   ├── reactions.js       #     리액션 토글
│   │   ├── pins.js            #     고정 메시지
│   │   ├── avatars.js         #     프로필 사진 (닉네임 기준)
│   │   └── subscriptions.js   #     푸시 구독
│   │
│   └── handlers/              #   소켓 이벤트 핸들러 — 각 파일이 register(socket, ctx) 를 내보냄
│       ├── index.js           #     핸들러 목록 등록
│       ├── session.js         #     join / disconnect
│       ├── chat.js            #     chat-message (타입별 검증, 저장, 개인화 브로드캐스트, 푸시)
│       ├── messageActions.js  #     delete-message / edit-message (작성자 확인)
│       ├── reactions.js       #     react
│       ├── history.js         #     load-more / load-until / search-messages / export-messages (ack)
│       ├── pins.js            #     pin-message / unpin-message
│       ├── linkPreview.js     #     link-preview (ack)
│       ├── avatar.js          #     set-avatar
│       ├── presence.js        #     mark-read / typing
│       └── pushSubscription.js#     push-subscribe / push-unsubscribe
│
├── public/                    # 브라우저 클라이언트 (정적 서빙, ESM)
│   ├── index.html             #   단일 페이지 UI (로그인 화면 + 채팅 화면)
│   ├── style.css              #   스타일 + 테마 (light/dark/intellij/excel/claude/claude-dark)
│   ├── client.js              #   진입점 — js/* 모듈을 순서대로 import
│   ├── package.json           #   {"type":"module"} (테스트에서 Node가 ESM으로 읽도록)
│   ├── manifest.json          #   PWA 매니페스트
│   ├── service-worker.js      #   백그라운드 푸시 수신 / 알림 클릭 처리
│   ├── icons/                 #   PWA 아이콘
│   ├── stickers/              #   스티커 이미지 — 파일을 넣으면 바로 목록에 나타남
│   └── js/
│       ├── socket.js          #     Socket.IO 연결 (전역 io 사용)
│       ├── state.js           #     공유 상태 객체, clientId(localStorage), 방 이름(URL)
│       ├── constants.js       #     클라이언트 상한값·저장소 키 (서버 config와 맞춰야 함)
│       ├── elements.js        #     DOM 요소 참조 모음
│       ├── login.js           #     입장 화면, 방 목록, 재입장
│       ├── connection.js      #     연결/재연결 상태 표시
│       ├── messages.js        #     메시지 렌더링·수정·삭제·고정·스크롤·더 보기 (가장 큰 모듈)
│       ├── compose.js         #     입력창, 전송, 스티커·사진 선택
│       ├── imageFile.js       #     사진 리사이즈/압축 → data URL
│       ├── gif.js             #     GIF 검색 패널
│       ├── mention.js         #     @멘션 자동완성
│       ├── reply.js           #     답장 대상 지정
│       ├── reactions.js       #     리액션 팝업·렌더링
│       ├── pins.js            #     고정 메시지 바
│       ├── search.js          #     메시지 검색 → 결과로 이동
│       ├── read.js            #     읽음 표시 보고/표시
│       ├── unread.js          #     탭 제목 안 읽은 수
│       ├── lastSeen.js        #     "여기까지 읽음" 구분선 기준 (localStorage)
│       ├── historyStore.js    #     새로고침 대비 방별 최근 대화 캐시 (sessionStorage)
│       ├── export.js          #     대화 내보내기 (+ exportFormat.js 텍스트 포맷)
│       ├── linkPreview.js     #     링크 미리보기 카드
│       ├── avatar.js          #     프로필 사진 업로드/표시
│       ├── lightbox.js        #     이미지 크게 보기
│       ├── notifications.js   #     포그라운드 알림 + 푸시 구독
│       ├── theme.js           #     테마 선택/저장
│       ├── toast.js           #     토스트 메시지
│       └── text.js            #     escapeHtml, 링크 변환, 날짜·시간 포맷
│
├── test/                      # node --test (파일마다 별도 프로세스)
│   ├── helpers/               #   socket-harness, fake-webpush, push 공용 시나리오
│   └── *.test.js              #   메모리/DB/PIN/VAPID/GIF 모드별로 파일 분리
│
├── docs/
│   ├── ARCHITECTURE.md        #   이 문서
│   └── images/                #   README 스크린샷
│
└── .github/workflows/
    ├── test.yml               #   push/PR마다 npm test (Node 20)
    └── keep-alive.yml         #   평일 KST 08~18시에 14분마다 Render 앱 핑 (무료 플랜 슬립 방지)
```

Git에 올라가지 않는 런타임 폴더: `node_modules/`, `.stickers-cache/`(축소된 스티커 캐시).

## 계층과 책임

| 계층 | 파일 | 하는 일 | 하지 않는 일 |
| --- | --- | --- | --- |
| 조립 | `server.js` | 라우터·핸들러 연결, DB init, 정리 타이머 | 비즈니스 로직 |
| 전송 | `lib/handlers/*`, `lib/routes.js` 등 | 입력 파싱·검증, rate limit, 권한 확인, 응답 | SQL 직접 실행 |
| 표현 | `lib/present.js`, `lib/emitters.js` | 보는 사람별 데이터 변환·전송 | 저장 |
| 상태 | `lib/state.js` | 접속자·읽음·작성자 캐시 (휘발성) | 영구 저장 |
| 저장 | `lib/store.js`, `lib/pinStore.js`, `lib/pushSubscriptions.js` | DB가 켜져 있으면 `db.js`, 아니면 메모리 | 검증 |
| DB | `db.js` → `lib/db/*` | SQL, 스키마, 7일 정리 | 소켓/HTTP |

## 핵심 흐름

### 입장 (`join`)

1. 클라이언트가 `{ nickname, clientId, pin, room }` 전송. `clientId`는 브라우저 localStorage의 UUID.
2. `session.js`: PIN 확인 → 닉네임/방 이름 정리 → 같은 방 닉네임 중복 확인(`state.isNicknameTaken`).
3. `socket.join(room)`, `state.users`와 `socket.data`에 기록.
4. 본인에게 `joined`, 방에 `system-message`·`user-list`·`read-update`.
5. 고정 목록(`pins`)과 최근 메시지(`history`, DB가 있을 때만)를 본인에게 전송.

### 메시지 전송 (`chat-message`)

```
client compose.js ──chat-message {type, content, replyTo}──▶ handlers/chat.js
   1. limiters.message.check           (도배 방지)
   2. parseContent                     (타입별 검증: sticker 파일 존재, image 용량, gif CDN, text 길이)
   3. state.rememberMessage            (작성자 캐시 — 삭제/수정 권한 확인용)
   4. db.insertMessage                 (DB 켜져 있으면)
   5. emit.emitPersonalized            (소켓마다 mine 값을 따로 계산해서 전송)
   6. push.notifyRoom                  (보낸 사람 제외, 본문 없이 "OO님이 메시지를 보냈습니다")
```

### 개인화 전송과 clientId 비공개

`clientId`는 닉네임을 바꿔도 유지되는 영구 식별자라 다른 사용자에게 노출되면 추적 수단이 됨.
그래서 서버는 이 값을 밖으로 내보내지 않고, 보는 사람마다 계산한 결과만 보냄:

- 메시지: `mine: boolean`
- 리액션: `{ emoji: { count, mine } }` (`present.reactionsForViewer`)
- 읽음: `{ minReadTime }` — 나를 제외한 방 사람들이 최소 어디까지 읽었는지

### 저장소 폴백

```
handlers ──▶ store / pinStore / pushSubscriptions ──┬─ db.enabled ──▶ db.js ──▶ lib/db/* ──▶ Turso
                                                    └─ 아니면 ─────▶ 모듈 안의 Map (재시작하면 사라짐)
```

`lib/db/*` 함수는 `whenEnabled(fallback, fn)`로 감싸져 있어 DB가 없으면 빈 값을 돌려줌.
DB가 꼭 필요한 기능(더 보기, 검색, 수정, 내보내기)은 핸들러에서 `db.enabled`를 확인하고 빈 결과를 돌려줌.

## 소켓 이벤트

### 클라이언트 → 서버

| 이벤트 | 핸들러 | 응답 방식 |
| --- | --- | --- |
| `join` | session | `joined` / `join-error` |
| `chat-message` | chat | 방에 `chat-message` (개인화) |
| `edit-message`, `delete-message` | messageActions | 방에 `message-edited` / `message-deleted` |
| `react` | reactions | 방에 `reaction-update` (개인화) |
| `pin-message`, `unpin-message` | pins | 방에 `pins`, 실패 시 `pin-error` |
| `load-more`, `load-until`, `search-messages`, `export-messages` | history | ack 콜백 |
| `link-preview` | linkPreview | ack 콜백 |
| `set-avatar` | avatar | 방에 `avatar-updated` |
| `mark-read` | presence | 방에 `read-update` (개인화) |
| `typing` | presence | 다른 사람들에게 `typing` |
| `push-subscribe`, `push-unsubscribe` | pushSubscription | 없음 |

### 서버 → 클라이언트 (그 밖에)

`system-message`(입장/퇴장), `user-list`, `history`, `upload-error`(이미지 용량 초과), `rate-limited`.

## HTTP 엔드포인트

| 경로 | 파일 | 설명 |
| --- | --- | --- |
| `GET /api/config` | routes.js | `pinRequired`, `pushPublicKey`, `gifEnabled` |
| `GET /api/rooms` | routes.js | 활성 방 + DB에 기록이 있는 방 |
| `GET /avatar/:nickname` | routes.js | data URL로 저장된 프로필 사진을 바이트로 디코딩해서 서빙 (1일 캐시) |
| `GET /api/gifs` | gifs.js | GIPHY 검색 프록시 (키는 서버에만), 키 없으면 503 |
| `GET /api/stickers` | stickers.js | 스티커 파일명 목록 |
| `GET /stickers/:file` | stickers.js | 스티커 이미지 (320px 초과 시 축소본) — `express.static`보다 먼저 등록 |
| 그 외 | `express.static` | `public/` 정적 파일 |

## 데이터 모델 (Turso)

| 테이블 | 키 | 주요 컬럼 |
| --- | --- | --- |
| `messages` | `id` | `type`, `content`, `nickname`, `client_id`, `room`, `time`, `reply_to`(JSON), `edited_at` |
| `reactions` | `(message_id, emoji, client_id)` | — |
| `pins` | `message_id` | `room`, `type`, `preview`, `nickname`, `time`, `pinned_at` |
| `avatars` | `nickname` | `image`(data URL), `updated_at` |
| `push_subscriptions` | `endpoint` | `client_id`, `room`, `p256dh`, `auth`, `created_at` |

- 메시지는 하루 한 번 정리되어 7일 지난 것은 삭제 (고정된 메시지는 제외).
- 사진(`image` 타입)은 base64 data URL로 `messages.content`에 저장 → 용량 상한 `IMAGE_MAX_LENGTH`.

## 보안·안정성 장치

- **입력 상한**: `config.MAX`로 모든 문자열 길이를 서버에서 다시 자름.
- **도배 방지**: `rateLimiter.LIMITS`에서 이벤트별로 제한, 초과하면 `rate-limited`.
- **경로 조작 방지**: 스티커 파일명은 `path.basename` 후 실제 목록에 있는지 확인.
- **외부 URL 제한**: GIF는 `https://media*.giphy.com`만 허용 (다른 사람 브라우저가 임의 주소로 요청하지 않도록).
- **SSRF 방어**: 링크 미리보기는 http/https 기본 포트만, 사설·로컬 IP 거부(DNS 조회 결과와 리다이렉트까지 검사), 크기·시간 제한.
- **알림 내용 비노출**: 푸시·포그라운드 알림 모두 메시지 본문을 싣지 않음.
- **권한**: 수정·삭제는 `state.messageMeta`의 작성자 clientId와 비교하고, DB 쿼리도 `client_id` 조건을 함께 걸어 확인.

## 테스트 구조

`node --test`는 파일마다 별도 프로세스라서, 모듈을 불러오는 시점에 정해지는 설정(DB, PIN, VAPID, GIPHY)은
**파일 단위로 모드를 나눠** 테스트함.

| 모드 | 파일 |
| --- | --- |
| 메모리 (기본) | `chat.test.js`, `chat-events.test.js`, `pins.test.js`, `nickname.test.js`, `http.test.js` |
| DB (로컬 libSQL 파일) | `chat-db.test.js`, `db.test.js`, `push-db.test.js` |
| 기능 꺼짐/반쪽 설정 | `db-disabled`, `push-disabled`, `push-half-config`, `gif-disabled`, `link-preview-blocked` |
| PIN 설정 | `chat-pin.test.js` |
| 외부 서비스 가짜 | `gif.test.js`, `link-preview.test.js`, `push.test.js` |
| 클라이언트 (jsdom) | `client.test.js` |
