#!/bin/bash
# OrisChat 배포 스크립트
#
# 사용법:
#   ./deploy.sh                    → 의존성 설치 + 서버 재시작만
#   ./deploy.sh "커밋 메시지"        → git 커밋+푸시까지 포함해서 배포

set -e
cd "$(dirname "$0")"

COMMIT_MSG="$1"

if [ -n "$COMMIT_MSG" ]; then
  echo "📝 변경사항 커밋 중..."
  git add -A
  if git diff --cached --quiet; then
    echo "   (커밋할 변경사항 없음, 스킵)"
  else
    git commit -m "$COMMIT_MSG

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
    echo "🚀 GitHub에 푸시 중..."
    git push
  fi
fi

echo "📦 의존성 설치 확인 중..."
npm install --silent

echo "🔄 서버 재시작 중..."
launchctl kickstart -k "gui/$(id -u)/com.orischat.server"

sleep 1
echo "🔍 상태 확인 중..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000)

if [ "$STATUS" = "200" ]; then
  echo "✅ 배포 완료! (HTTP $STATUS)"
else
  echo "⚠️  서버 응답 이상 (HTTP $STATUS) — logs/err.log 확인해보세요"
  exit 1
fi
