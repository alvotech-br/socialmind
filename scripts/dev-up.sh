#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "▶ Subindo containers..."
docker compose up -d

echo "▶ Aguardando PostgreSQL (dev)..."
until docker compose exec -T postgres pg_isready -U user -d socialplatform_dev > /dev/null 2>&1; do
  sleep 1
done
echo "  ✓ PostgreSQL dev pronto"

echo "▶ Aguardando PostgreSQL (test)..."
until docker compose exec -T postgres_test pg_isready -U user -d socialplatform_test > /dev/null 2>&1; do
  sleep 1
done
echo "  ✓ PostgreSQL test pronto"

echo "▶ Aguardando Redis..."
until docker compose exec -T redis redis-cli ping > /dev/null 2>&1; do
  sleep 1
done
echo "  ✓ Redis pronto"

echo "▶ Rodando migrations..."
pnpm --filter db migrate:dev

echo "▶ Rodando seed..."
pnpm --filter db seed

echo ""
echo "✅ Ambiente local pronto!"
echo "   PostgreSQL dev:  localhost:5432"
echo "   PostgreSQL test: localhost:5433"
echo "   Redis:           localhost:6379"
echo "   MinIO API:       localhost:9000"
echo "   MinIO Console:   localhost:9001  (minioadmin / minioadmin)"
