.PHONY: test
test:
	docker compose up -d --wait db
	cd backend && uv run pytest
