const fs = require('fs');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const { STICKERS_DIR, STICKERS_CACHE_DIR, STICKER_EXTENSIONS, STICKER_MAX_DIMENSION } = require('./config');

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

// 원본이 크면 줄여서 캐시에 저장해두고 그 파일의 경로를, 이미 충분히 작으면 원본
// 경로를 돌려줌 (재인코딩으로 인한 품질 손실 방지).
async function resolveStickerFile(filename) {
  const srcPath = path.join(STICKERS_DIR, filename);
  const cachePath = path.join(STICKERS_CACHE_DIR, filename);
  const srcStat = fs.statSync(srcPath);

  // 리사이즈된 캐시가 이미 있고 원본보다 최신이면 그대로 사용
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).mtimeMs >= srcStat.mtimeMs) {
    return cachePath;
  }

  const isGif = path.extname(filename).toLowerCase() === '.gif';
  const image = sharp(srcPath, { animated: isGif });
  const meta = await image.metadata();

  if ((meta.width || 0) <= STICKER_MAX_DIMENSION && (meta.height || 0) <= STICKER_MAX_DIMENSION) {
    return srcPath;
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
  return cachePath;
}

const router = express.Router();

router.get('/api/stickers', (req, res) => {
  res.json(listStickers());
});

// 스티커 이미지 서빙. express.static보다 먼저 등록해야 이 라우트가 우선 처리됨.
router.get('/stickers/:filename', async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!listStickers().includes(filename)) {
    return res.status(404).end();
  }

  try {
    res.sendFile(await resolveStickerFile(filename));
  } catch (err) {
    console.error('스티커 처리 중 오류:', err);
    res.status(500).end();
  }
});

module.exports = { listStickers, stickersRouter: router };
