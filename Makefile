.PHONY: dev check test

dev:
	docker compose up --build

check:
	pnpm check

test:
	pnpm test
