// 클라이언트가 보낸 값을 검증하는 순수 함수들

// base64 이미지 data URL인지, 허용 용량 이내인지
function isValidImageDataUrl(value, maxLength) {
  return value.startsWith('data:image/') && value.length <= maxLength;
}

// GIF 메시지는 GIPHY CDN 주소만 허용함 — 임의의 URL을 넣으면 다른 사람 브라우저가
// 그 주소로 요청을 보내게 되므로(IP 노출/추적 픽셀) 호스트를 제한함.
function isValidGifUrl(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^media\d*\.giphy\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

module.exports = { isValidImageDataUrl, isValidGifUrl };
