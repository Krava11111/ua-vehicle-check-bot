.PHONY: install lint typecheck test migrate up down logs import
install:
	python -m pip install -e ".[dev]"
lint:
	ruff check .
typecheck:
	mypy app data_importer
test:
	pytest -q
migrate:
	alembic upgrade head
up:
	docker compose up -d --build
down:
	docker compose down
logs:
	docker compose logs -f bot
import:
	docker compose --profile tools run --rm worker --file /data/mvs.zip

