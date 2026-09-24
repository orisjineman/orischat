// 프로필 사진 (닉네임 기준으로 저장 — 닉네임이 곧 방에서 보이는 신원이라
// 별도 식별자를 추가로 노출할 필요가 없음)
const { query, run, whenEnabled } = require('./client');

const setAvatar = whenEnabled(
  () => undefined,
  (nickname, imageDataUrl) =>
    run(
      `INSERT INTO avatars (nickname, image, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(nickname) DO UPDATE SET image = excluded.image, updated_at = excluded.updated_at`,
      [nickname, imageDataUrl, Date.now()]
    )
);

// { image, updatedAt } 또는 등록된 적 없으면 null
const getAvatar = whenEnabled(
  () => null,
  async (nickname) => {
    const [row] = await query('SELECT image, updated_at as updatedAt FROM avatars WHERE nickname = ?', [nickname]);
    return row || null;
  }
);

module.exports = { setAvatar, getAvatar };
