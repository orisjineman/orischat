const express = require('express');
const db = require('../db');
const push = require('../push');
const store = require('./store');
const { CHAT_PIN, GIPHY_API_KEY, KNOWN_ROOMS_LIMIT, MAX } = require('./config');
const { activeUserCounts } = require('./state');

const router = express.Router();

router.get('/api/config', (req, res) => {
  res.json({
    pinRequired: Boolean(CHAT_PIN),
    pushPublicKey: push.enabled ? push.publicKey : null,
    gifEnabled: Boolean(GIPHY_API_KEY),
  });
});

// 프로필 사진 서빙: data URL로 저장해둔 걸 실제 이미지 바이트로 디코딩해서 내려줌
// (소켓으로 매번 base64를 실어보내는 대신, 브라우저가 URL 기준으로 캐시할 수 있게).
router.get('/avatar/:nickname', async (req, res) => {
  const nickname = req.params.nickname.slice(0, MAX.NICKNAME);
  let avatar = null;

  try {
    avatar = await store.getAvatar(nickname);
  } catch (err) {
    console.error('프로필 사진 조회 오류:', err);
  }

  if (!avatar) return res.status(404).end();

  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(avatar.image);
  if (!match) return res.status(404).end();

  res.set('Cache-Control', 'public, max-age=86400');
  res.set('Content-Type', match[1]);
  res.send(Buffer.from(match[2], 'base64'));
});

// 현재 활성 방(접속자 있음) + DB에 기록이 남아있는 방을 합쳐서 목록으로 보여줌.
// 로그인 화면에서 "이 방들 중에 골라서 들어가기"용.
router.get('/api/rooms', async (req, res) => {
  let known = [];
  if (db.enabled) {
    try {
      known = await db.getKnownRooms(KNOWN_ROOMS_LIMIT);
    } catch (err) {
      console.error('방 목록 조회 오류:', err);
    }
  }

  const merged = new Map();
  for (const row of known) {
    merged.set(row.room, { name: row.room, activeUsers: 0, lastActivity: row.lastActivity });
  }
  for (const [room, count] of activeUserCounts().entries()) {
    const existing = merged.get(room) || { name: room, activeUsers: 0, lastActivity: 0 };
    existing.activeUsers = count;
    merged.set(room, existing);
  }

  const list = Array.from(merged.values()).sort(
    (a, b) => b.activeUsers - a.activeUsers || b.lastActivity - a.lastActivity
  );
  res.json(list);
});

module.exports = { apiRouter: router };
