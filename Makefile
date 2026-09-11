.DEFAULT_GOAL := check
.PHONY: check lint test e2e cover setup deps-guard docker-build smoke clean

# `make check` = линт + unit-тесты. Это гейт перед «готово»: быстро, детерминированно,
# ненулевой код при любом провале. Тяжёлое (playwright, docker) — отдельные цели.
check: lint test

deps-guard:
	@test -d node_modules || { echo "нет node_modules — выполните: make setup"; exit 1; }

setup:
	npm ci || npm install

lint: deps-guard
	npm run lint

test: deps-guard
	npm run test

cover: deps-guard
	npx vitest run --coverage

e2e: deps-guard
	npx playwright install --with-deps chromium
	npm run test:e2e

docker-build:
	docker build -f Dockerfile.web -t corpfly-web:dev .
	docker build -f Dockerfile.api -t corpfly-api:dev .

clean:
	rm -rf coverage test-results playwright-report
