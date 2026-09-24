// 브라우저에서 캔버스로 이미지를 줄여 JPEG data URL로 만듦. 서버 파일시스템에는
// 저장 안 함(Render 무료 플랜은 재시작하면 파일이 날아감) — 대신 base64로 DB에 저장함.
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    reader.readAsDataURL(file);
  });
}

// 긴 쪽이 maxDimension을 넘으면 비율을 유지하며 줄임
export async function resizeImageFile(file, maxDimension, quality) {
  const img = await loadImageFromFile(file);
  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

// 가운데를 정사각형으로 잘라 size x size로 만듦 (프로필 사진용)
export async function resizeImageSquare(file, size, quality) {
  const img = await loadImageFromFile(file);
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', quality);
}
