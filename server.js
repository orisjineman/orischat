const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sharp = require('sharp');
const db = require('./db');
const push = require('./push');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// 설정해두면 입장 시 이 비밀번호를 맞춰야 함 (안 정하면 누구나 바로 입장 가능)
const CHAT_PIN = process.env.CHAT_PIN || '';

const DEFAULT_ROOM = 'general';
const HISTORY_PAGE_SIZE = 50;

function cleanRoomName(name) {
  const trimmed = String(name || '').trim().slice(0, 30);
  return trimmed || DEFAULT_ROOM;
}

// 현재 접속 중인 사용자 목록 (socket.id -> { nickname, room })
const users = new Map();

// 최근 메시지의 작성자/방 정보 (messageId -> { clientId, room }).
// DB(TURSO)가 없을 때는 삭제 권한을 확인할 유일한 수단이고, DB가 있을 때도
// 매번 조회하지 않고 빠르게 확인하는 캐시 역할을 함. 무한히 커지지 않도록 오래된
// 항목은 버림.
const MESSAGE_META_LIMIT = 1000;
const messageMeta = new Map();
function rememberMessage(id, clientId, room) {
  messageMeta.set(id, { clientId, room });
  if (messageMeta.size > MESSAGE_META_LIMIT) {
    messageMeta.delete(messageMeta.keys().next().value);
  }
}

// 메시지별 반응(이모지 리액션): messageId -> { emoji -> Set of clientId }
// TURSO_DATABASE_URL이 없을 때(로컬 개발 등)만 쓰는 메모리 폴백. DB가 켜져
// 있으면 db.js가 진짜 저장소 역할을 함.
const reactions = new Map();

function usersInRoom(room) {
  return Array.from(users.values())
    .filter((u) => u.room === room)
    .map((u) => u.nickname);
}

function broadcastUserList(room) {
  io.to(room).emit('user-list', usersInRoom(room));
}

// room 안의 모든 소켓에게 "각자 다른 내용"을 담아 개별적으로 전송함. 예를 들어
// 메시지가 "내가 쓴 건지" 여부는 보는 사람마다 다름. 이렇게 서버가 각자에게 맞는
// 값만 계산해서 보내면, 다른 사람의 영구 식별자(clientId, localStorage에 저장돼서
// 닉네임을 바꿔도 안 변함)를 클라이언트끼리 서로 알 필요가 없어져서 추적당할
// 걱정이 줄어듦.
function emitPersonalized(room, event, factory) {
  for (const [, s] of io.sockets.sockets) {
    if (s.data.room !== room) continue;
    s.emit(event, factory(s));
  }
}

// 리액션 {emoji: [clientId, ...]} 를 보는 사람 기준 {emoji: {count, mine}} 로 변환
function reactionsForViewer(reactionsObj, viewerClientId) {
  const out = {};
  for (const [emoji, ids] of Object.entries(reactionsObj || {})) {
    if (!ids || !ids.length) continue;
    out[emoji] = { count: ids.length, mine: ids.includes(viewerClientId) };
  }
  return out;
}

// DB에서 읽은 메시지 행(row, client_id 포함)을 특정 사용자에게 보낼 형태로 변환.
// 실제 clientId는 절대 내려주지 않고 "내 것인지"만 알려줌.
function toClientMessage(row, viewerClientId) {
  const { clientId, reactions: r, ...rest } = row;
  return { ...rest, mine: clientId === viewerClientId, reactions: reactionsForViewer(r, viewerClientId) };
}

// --- 짧은 시간에 너무 많은 요청을 보내는 걸 막는 간단한 sliding-window rate limiter ---
function createLimiter(maxHits, windowMs) {
  const hits = new Map(); // socket.id -> timestamp[]
  return {
    check(socketId) {
      const now = Date.now();
      const arr = (hits.get(socketId) || []).filter((t) => now - t < windowMs);
      arr.push(now);
      hits.set(socketId, arr);
      return arr.length <= maxHits;
    },
    forget(socketId) {
      hits.delete(socketId);
    },
  };
}

const messageLimiter = createLimiter(8, 5000); // 5초에 8개까지
const reactionLimiter = createLimiter(20, 5000);
const loadMoreLimiter = createLimiter(10, 10000);
const deleteLimiter = createLimiter(10, 10000);

app.get('/api/config', (req, res) => {
  res.json({ pinRequired: Boolean(CHAT_PIN), pushPublicKey: push.enabled ? push.publicKey : null });
});

// public/stickers 폴더에 이미지를 넣으면 자동으로 스티커로 인식됨 (서버 재시작 불필요)
const STICKERS_DIR = path.join(__dirname, 'public', 'stickers');
const STICKERS_CACHE_DIR = path.join(__dirname, '.stickers-cache');
const STICKER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// 스티커 원본이 이 크기(긴 쪽 기준, px)보다 크면 줄여서 보내고, 작으면 원본 그대로 보냄
const STICKER_MAX_DIMENSION = 320;

function listStickers() {
  try {
    return fs
      .readdirSync(STICKERS_DIR)
      .filter((name) => STICKER_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

app.get('/api/stickers', (req, res) => {
  res.json(listStickers());
});

// 스티커 이미지 서빙: 원본이 크면 줄여서 캐시에 저장해두고 그걸 내려줌.
// express.static보다 먼저 등록해야 이 라우트가 우선 처리됨.
app.get('/stickers/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!listStickers().includes(filename)) {
    return res.status(404).end();
  }

  const srcPath = path.join(STICKERS_DIR, filename);
  const cachePath = path.join(STICKERS_CACHE_DIR, filename);

  try {
    const srcStat = fs.statSync(srcPath);

    // 리사이즈된 캐시가 이미 있고 원본보다 최신이면 그대로 서빙
    if (fs.existsSync(cachePath)) {
      const cacheStat = fs.statSync(cachePath);
      if (cacheStat.mtimeMs >= srcStat.mtimeMs) {
        return res.sendFile(cachePath);
      }
    }

    const isGif = path.extname(filename).toLowerCase() === '.gif';
    const image = sharp(srcPath, { animated: isGif });
    const meta = await image.metadata();

    // 원본이 이미 충분히 작으면 재인코딩 없이 그대로 서빙 (품질 손실 방지)
    if ((meta.width || 0) <= STICKER_MAX_DIMENSION && (meta.height || 0) <= STICKER_MAX_DIMENSION) {
      return res.sendFile(srcPath);
    }

    fs.mkdirSync(STICKERS_CACHE_DIR, { recursive: true });
    await image
      .resize({
        width: STICKER_MAX_DIMENSION,
        height: STICKER_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toFile(cachePath);

    res.sendFile(cachePath);
  } catch (err) {
    console.error('스티커 처리 중 오류:', err);
    res.status(500).end();
  }
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    // 문자열(구버전 클라이언트)과 { nickname, clientId, pin, room } 객체 둘 다 지원
    const { nickname, clientId, pin, room } =
      typeof data === 'string' ? { nickname: data, clientId: null, pin: '', room: '' } : (data || {});

    if (CHAT_PIN && pin !== CHAT_PIN) {
      socket.emit('join-error', '비밀번호가 틀렸습니다.');
      return;
    }

    const cleanName = String(nickname || '').trim().slice(0, 20) || `손님${socket.id.slice(0, 4)}`;
    // clientId는 브라우저마다 고유한 값으로, 재연결되어도 "나"를 정확히 구분하기 위해 사용.
    // 서버 안에서만 쓰고, 남에게 보낼 땐 절대 그대로 내려주지 않음(emitPersonalized 참고).
    const id = String(clientId || socket.id).slice(0, 100);
    const roomName = cleanRoomName(room);

    if (socket.data.room && socket.data.room !== roomName) {
      socket.leave(socket.data.room);
    }
    socket.join(roomName);

    users.set(socket.id, { nickname: cleanName, room: roomName });
    socket.data.nickname = cleanName;
    socket.data.clientId = id;
    socket.data.room = roomName;

    socket.emit('joined', { nickname: cleanName, clientId: id, room: roomName });
    socket.broadcast.to(roomName).emit('system-message', `${cleanName}님이 입장했습니다.`);
    broadcastUserList(roomName);

    if (db.enabled) {
      db.getRecentMessages(roomName, HISTORY_PAGE_SIZE)
        .then((history) => {
          for (const m of history) rememberMessage(m.id, m.clientId, roomName);
          socket.emit('history', history.map((m) => toClientMessage(m, id)));
        })
        .catch((err) => console.error('히스토리 조회 오류:', err));
    }
  });

  socket.on('chat-message', async (payload) => {
    if (!messageLimiter.check(socket.id)) {
      socket.emit('rate-limited', { action: 'chat-message' });
      return;
    }

    const nickname = socket.data.nickname;
    const clientId = socket.data.clientId;
    const room = socket.data.room;
    if (!nickname || !clientId || !room) return; // join 하지 않은 소켓의 요청은 무시

    // 문자열(구버전 클라이언트)과 { type, content } 객체 둘 다 지원
    const data = typeof payload === 'string' ? { type: 'text', content: payload } : (payload || {});
    const id = crypto.randomUUID();
    const time = Date.now();

    let type;
    let content;

    if (data.type === 'sticker') {
      // 경로 조작(../ 등) 방지 + 실제 존재하는 스티커 파일인지 검증
      const filename = path.basename(String(data.content || ''));
      if (!listStickers().includes(filename)) return;
      type = 'sticker';
      content = filename;
    } else {
      const message = String(data.content || '').trim().slice(0, 500);
      if (!message) return;
      type = 'text';
      content = message;
    }

    rememberMessage(id, clientId, room);

    if (db.enabled) {
      try {
        await db.insertMessage({ id, type, content, nickname, clientId, room, time });
      } catch (err) {
        console.error('메시지 저장 오류:', err);
      }
    }

    const base = { id, type, content, nickname, time };
    emitPersonalized(room, 'chat-message', (s) => ({
      ...base,
      mine: s.data.clientId === clientId,
      reactions: {},
    }));

    push.notifyRoom(room, { nickname, excludeClientId: clientId }).catch((err) => console.error('푸시 알림 오류:', err));
  });

  socket.on('react', async ({ messageId, emoji } = {}) => {
    if (!reactionLimiter.check(socket.id)) {
      socket.emit('rate-limited', { action: 'react' });
      return;
    }

    const clientId = socket.data.clientId;
    const room = socket.data.room;
    if (!clientId || !room || !messageId || !emoji) return;

    const meta = messageMeta.get(messageId);
    if (meta && meta.room !== room) return; // 다른 방의 메시지엔 반응할 수 없음

    let summary;

    if (db.enabled) {
      try {
        summary = await db.toggleReaction(messageId, emoji, clientId);
      } catch (err) {
        console.error('리액션 저장 오류:', err);
        return;
      }
    } else {
      // 메모리 전용 폴백 (DB 미설정 시)
      if (!reactions.has(messageId)) reactions.set(messageId, new Map());
      const byEmoji = reactions.get(messageId);
      if (!byEmoji.has(emoji)) byEmoji.set(emoji, new Set());
      const clientIds = byEmoji.get(emoji);

      if (clientIds.has(clientId)) {
        clientIds.delete(clientId);
        if (clientIds.size === 0) byEmoji.delete(emoji);
      } else {
        clientIds.add(clientId);
      }

      summary = {};
      for (const [e, ids] of byEmoji.entries()) {
        summary[e] = Array.from(ids);
      }
    }

    emitPersonalized(room, 'reaction-update', (s) => ({
      messageId,
      reactions: reactionsForViewer(summary, s.data.clientId),
    }));
  });

  // 본인이 쓴 메시지만 삭제 가능 (clientId가 작성자와 일치할 때만)
  socket.on('delete-message', async ({ messageId } = {}) => {
    if (!deleteLimiter.check(socket.id)) return;

    const clientId = socket.data.clientId;
    const room = socket.data.room;
    if (!clientId || !room || !messageId) return;

    const meta = messageMeta.get(messageId);
    if (!meta || meta.clientId !== clientId || meta.room !== room) return;

    messageMeta.delete(messageId);
    reactions.delete(messageId);

    if (db.enabled) {
      try {
        await db.deleteMessage(messageId, clientId);
      } catch (err) {
        console.error('메시지 삭제 오류:', err);
      }
    }

    io.to(room).emit('message-deleted', { messageId });
  });

  // "이전 메시지 더 보기" — DB가 없으면 더 볼 과거 기록이 없으므로 빈 배열만 응답
  socket.on('load-more', async ({ beforeTime } = {}, callback) => {
    if (typeof callback !== 'function') return;
    if (!loadMoreLimiter.check(socket.id)) return callback([]);

    const room = socket.data.room;
    const clientId = socket.data.clientId;
    if (!room || !clientId || !db.enabled || !beforeTime) return callback([]);

    try {
      const older = await db.getMessagesBefore(room, beforeTime, HISTORY_PAGE_SIZE);
      for (const m of older) rememberMessage(m.id, m.clientId, room);
      callback(older.map((m) => toClientMessage(m, clientId)));
    } catch (err) {
      console.error('이전 메시지 조회 오류:', err);
      callback([]);
    }
  });

  // 백그라운드 푸시 알림 구독/해제 (탭이 닫혀있어도 알림 받기)
  socket.on('push-subscribe', async (subscription) => {
    const clientId = socket.data.clientId;
    const room = socket.data.room;
    if (!clientId || !room || !subscription || !subscription.endpoint) return;
    try {
      await push.subscribe({ endpoint: subscription.endpoint, clientId, room, keys: subscription.keys });
    } catch (err) {
      console.error('푸시 구독 저장 오류:', err);
    }
  });

  socket.on('push-unsubscribe', async ({ endpoint } = {}) => {
    try {
      await push.unsubscribe(endpoint);
    } catch (err) {
      console.error('푸시 구독 해제 오류:', err);
    }
  });

  socket.on('typing', (isTyping) => {
    const nickname = socket.data.nickname;
    const room = socket.data.room;
    if (!nickname || !room) return;
    socket.broadcast.to(room).emit('typing', { nickname, isTyping: !!isTyping });
  });

  socket.on('disconnect', () => {
    messageLimiter.forget(socket.id);
    reactionLimiter.forget(socket.id);
    loadMoreLimiter.forget(socket.id);
    deleteLimiter.forget(socket.id);

    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      socket.broadcast.to(user.room).emit('system-message', `${user.nickname}님이 퇴장했습니다.`);
      broadcastUserList(user.room);
    }
  });
});

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 하루에 한 번

// port를 직접 넘기면(테스트에서 0을 넘겨 임의의 빈 포트를 쓰는 등) 그 값을,
// 아니면 PORT 환경 변수(기본값 3000)를 사용함.
function start(port = PORT) {
  return db
    .init()
    .catch((err) => console.error('DB 초기화 오류:', err))
    .then(() => {
      // 주의: .finally()의 콜백 반환값은 체인 결과에 반영되지 않으므로(원래
      // 값/에러가 그대로 전달됨) 포트 번호를 돌려주려면 .then()을 써야 함.
      if (db.enabled) {
        db.cleanupOldMessages().catch((err) => console.error('오래된 메시지 정리 오류:', err));
        setInterval(() => {
          db.cleanupOldMessages().catch((err) => console.error('오래된 메시지 정리 오류:', err));
        }, CLEANUP_INTERVAL_MS);
      }

      return new Promise((resolve) => {
        server.listen(port, () => {
          console.log(`채팅 서버가 http://localhost:${server.address().port} 에서 실행 중입니다.`);
          resolve(server.address().port);
        });
      });
    });
}

// 테스트에서 require('./server')로 불러와 직접 listen을 제어할 수 있도록,
// 이 파일이 커맨드로 바로 실행됐을 때만 자동으로 서버를 띄움.
if (require.main === module) {
  start();
}

module.exports = { app, server, io, start };
