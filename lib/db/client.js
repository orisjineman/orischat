// Turso(libSQL) 연결. TURSO_DATABASE_URL, TURSO_AUTH_TOKEN 환경 변수가 없으면 DB 없이
// (메모리만으로) 동작하도록 되어 있어서, 로컬 개발 시 별도 설정 없이도 서버가 돌아감.
const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

const enabled = Boolean(url);
const client = enabled ? createClient({ url, authToken }) : null;

// SELECT 결과 행 배열
async function query(sql, args = []) {
  return (await client.execute({ sql, args })).rows;
}

// 결과가 필요 없는 INSERT/UPDATE/DELETE
async function run(sql, args = []) {
  await client.execute({ sql, args });
}

// 여러 문장을 한 트랜잭션으로. statements: [{ sql, args }]
async function transaction(statements) {
  await client.batch(statements, 'write');
}

// SQL의 "?, ?, ?" 자리표시자 문자열
function placeholders(count) {
  return new Array(count).fill('?').join(',');
}

// DB가 꺼져 있으면 fn을 실행하지 않고 fallback()의 값을 돌려주는 함수로 감쌈.
// (호출하는 쪽이 DB 유무를 신경 쓰지 않아도 되도록)
function whenEnabled(fallback, fn) {
  return async (...args) => (enabled ? fn(...args) : fallback());
}

module.exports = { enabled, query, run, transaction, placeholders, whenEnabled };
