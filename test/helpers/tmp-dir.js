// DB 테스트가 쓰는 임시 폴더 정리. Windows에서는 libsql 클라이언트가 프로세스가 끝날 때까지
// DB 파일을 잡고 있어서 지우기가 EPERM으로 실패함 — OS 임시 폴더라 남아도 문제없으니 무시함.
const fs = require('fs');

function removeTmpDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
  }
}

module.exports = { removeTmpDir };
