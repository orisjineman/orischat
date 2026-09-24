// 클라이언트가 보낸 값을 검증하는 순수 함수들

// base64 이미지 data URL인지, 허용 용량 이내인지
function isValidImageDataUrl(value, maxLength) {
  return value.startsWith('data:image/') && value.length <= maxLength;
}

module.exports = { isValidImageDataUrl };
