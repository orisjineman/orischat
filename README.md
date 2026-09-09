# OrisChat

간단한 실시간 웹 채팅 서버입니다. Node.js + Express + Socket.IO로 만들었고, 별도 설치 없이 브라우저에서 바로 접속해 대화할 수 있습니다.

## 기능

- 닉네임만 입력하면 바로 입장
- 실시간 메시지 송수신 (WebSocket 기반)
- 입장 / 퇴장 시스템 알림
- 현재 접속자 목록
- "입력 중..." 표시
- 라이트 / 다크 모드 자동 대응 UI

## 기술 스택

- [Express](https://expressjs.com/) — 정적 파일 서빙
- [Socket.IO](https://socket.io/) — 실시간 양방향 통신
- Vanilla JS / HTML / CSS (프론트엔드 프레임워크 없음)

## 시작하기

```bash
npm install
npm start
```

기본적으로 `http://localhost:3000` 에서 접속할 수 있습니다. 포트를 바꾸고 싶다면 `PORT` 환경 변수를 지정하세요.

```bash
PORT=4000 npm start
```

## 프로젝트 구조

```
.
├── server.js          # Express + Socket.IO 서버
├── public/
│   ├── index.html      # 채팅 화면 UI
│   ├── style.css        # 스타일
│   └── client.js        # 클라이언트 로직 (입장, 메시지 송수신 등)
└── package.json
```

## 외부에서 접속 가능하게 만들기

집 PC를 서버로 써서 인터넷 어디서나 접속하게 하려면 아래 과정이 필요합니다.

1. 공유기에서 이 PC의 내부 IP를 고정 (DHCP 예약)
2. 공유기 포트포워딩으로 외부 포트를 이 서버의 포트(기본 3000)로 연결
3. DDNS(Dynamic DNS)로 고정 도메인 발급 — 공인 IP가 바뀌어도 같은 주소 유지
4. (선택) 서버가 항상 켜져 있도록 launchd(macOS) 등으로 자동 재시작 등록

## 참고 / 한계

- 메시지가 메모리에만 저장되어 서버를 재시작하면 대화 기록이 사라집니다 (별도 DB 연동 없음)
- 로그인/비밀번호가 없어 접속 주소를 아는 사람은 누구나 들어올 수 있습니다
- 기본 설정은 HTTP이며 암호화되지 않습니다 — 운영 환경에서는 리버스 프록시(예: Caddy, nginx)로 HTTPS를 앞에 두는 것을 권장합니다

## 라이선스

개인 사이드 프로젝트입니다.
