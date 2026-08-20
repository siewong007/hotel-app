# Hotel App - Project Makefile
# Provides common development commands across all three projects.

BUN ?= $(shell command -v bun 2>/dev/null || printf '%s' "$$HOME/.bun/bin/bun")
override DATABASE_URL := $(value DATABASE_URL)
export DATABASE_URL

.PHONY: help setup-all setup-be setup-fe setup-desktop \
        dev-be dev-fe dev-desktop \
        build-be build-fe build-desktop \
        check-be check-fe check-desktop check-all \
        lint-be lint-fe lint-desktop lint-all \
        test-be test-fe \
        docker-up docker-up-pg19-tuned docker-down docker-build \
        db-setup db-patch require-database-url db-reset db-pg19-tune db-pg19-tune-rollback db-pg19-benchmark \
        db-repack db-repack-full \
        prepare-desktop docs \
        fmt fmt-all \
        clean clean-all

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Setup ────────────────────────────────────────────────────────────────────

setup-all: setup-be setup-fe setup-desktop ## Install dependencies for all projects

setup-be: ## Install backend dependencies
	cd hotel-app-be && cargo fetch

setup-fe: ## Install frontend dependencies
	cd hotel-web-fe && $(BUN) install

setup-desktop: ## Install desktop dependencies
	cd hotel-desktop && $(BUN) install && cd src-tauri && cargo fetch

# ─── Development ──────────────────────────────────────────────────────────────

dev-be: ## Start backend in development mode
	cd hotel-app-be && cargo run

dev-fe: ## Start frontend development server
	cd hotel-web-fe && $(BUN) run start

dev-desktop: ## Start desktop app in development mode
	cd hotel-desktop && $(BUN) run dev

# ─── Build ────────────────────────────────────────────────────────────────────

build-be: ## Build backend release
	cd hotel-app-be && cargo build --release

build-fe: ## Build frontend production
	cd hotel-web-fe && $(BUN) run build

build-desktop: ## Build desktop production
	cd hotel-desktop && $(BUN) run build

# ─── Type Checking ────────────────────────────────────────────────────────────

check-be: ## Check backend compilation
	cd hotel-app-be && cargo check --all-features

check-fe: ## Typecheck frontend
	cd hotel-web-fe && $(BUN) run typecheck

check-desktop: ## Check desktop compilation
	cd hotel-desktop/src-tauri && cargo check

check-all: check-be check-fe check-desktop ## Typecheck all projects

# ─── Linting ──────────────────────────────────────────────────────────────────

lint-be: ## Lint backend
	cd hotel-app-be && cargo clippy --all-features -- -D warnings

lint-fe: ## Lint frontend
	cd hotel-web-fe && $(BUN) run lint

lint-desktop: ## Lint desktop
	cd hotel-desktop/src-tauri && cargo clippy -- -D warnings

lint-all: lint-be lint-fe lint-desktop ## Lint all projects

# ─── Formatting ───────────────────────────────────────────────────────────────

fmt-be: ## Format backend code
	cd hotel-app-be && cargo fmt

fmt-desktop: ## Format desktop code
	cd hotel-desktop/src-tauri && cargo fmt

fmt-all: fmt-be fmt-desktop ## Format all Rust code

fmt: fmt-all ## Alias for fmt-all

# ─── Testing ──────────────────────────────────────────────────────────────────

test-be: ## Run all backend tests
	cd hotel-app-be && cargo test --all-features

test-be-pg: ## Run backend PostgreSQL tests (requires DATABASE_URL)
	cd hotel-app-be && cargo test --features postgres --no-default-features

test-fe: ## Run frontend tests
	cd hotel-web-fe && $(BUN) run test -- --run

test-all: test-be test-fe ## Test all projects

# ─── Docker ───────────────────────────────────────────────────────────────────

docker-up: ## Start all Docker services
	docker compose up -d

docker-up-pg19-tuned: ## Start the PG19 experimental profile and apply speculative tuning
	docker compose -f docker-compose.yml -f docker-compose.pg19-tuned.yml up -d

docker-down: ## Stop all Docker services
	docker compose down

docker-build: ## Build all Docker images
	docker compose build

docker-logs: ## View Docker logs
	docker compose logs -f

# ─── Database ─────────────────────────────────────────────────────────────────

require-database-url:
	@case "$$DATABASE_URL" in *[![:space:]]*) ;; *) printf '%s\n' 'DATABASE_URL is required' >&2; exit 1 ;; esac

db-setup: require-database-url ## Initialize an empty PostgreSQL database at V1 (requires DATABASE_URL)
	psql "$$DATABASE_URL" -f hotel-app-be/database/postgres/migrations/0001_v1_baseline.sql
	psql "$$DATABASE_URL" -f hotel-app-be/database/postgres/seed.sql
	$(MAKE) db-patch

db-patch: require-database-url ## Apply verified V1 compatibility patches (requires DATABASE_URL)
	hotel-app-be/database/postgres/apply-patches.sh

db-reset: ## Reset and re-create PostgreSQL database
	psql "$$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	$(MAKE) db-setup

db-pg19-tune: ## Apply opt-in PostgreSQL 19 Beta 2 physical/planner tuning
	psql "$$DATABASE_URL" -f hotel-app-be/database/postgres/optimization/pg19_beta2.sql
	psql "$$DATABASE_URL" -c "ALTER SYSTEM SET autovacuum_max_parallel_workers = 4;"
	psql "$$DATABASE_URL" -c "SELECT pg_reload_conf();"

db-pg19-tune-rollback: ## Revert the opt-in PostgreSQL 19 Beta 2 schema tuning
	psql "$$DATABASE_URL" -f hotel-app-be/database/postgres/optimization/pg19_beta2_rollback.sql
	psql "$$DATABASE_URL" -c "ALTER SYSTEM RESET autovacuum_max_parallel_workers;"
	psql "$$DATABASE_URL" -c "SELECT pg_reload_conf();"

db-pg19-benchmark: ## Collect PostgreSQL 19 Beta 2 settings and representative query plans
	psql "$$DATABASE_URL" -f hotel-app-be/database/postgres/optimization/pg19_beta2_benchmark.sql

db-repack: ## Online-rebuild one table (PostgreSQL 19 REPACK CONCURRENTLY); usage: make db-repack TABLE=public.bookings
	@test -n "$(TABLE)" || { echo "Usage: make db-repack TABLE=public.bookings"; exit 1; }
	psql "$$DATABASE_URL" -c "REPACK (CONCURRENTLY, ANALYZE, VERBOSE) $(TABLE);"

db-repack-full: ## Rebuild and analyze every table (locking REPACK; maintenance window only)
	psql "$$DATABASE_URL" -c "REPACK (ANALYZE, VERBOSE);"

# ─── Desktop Preparation ──────────────────────────────────────────────────────

prepare-desktop: ## Prepare desktop app resources
	cd hotel-desktop && $(BUN) run desktop:prepare

# ─── Documentation ────────────────────────────────────────────────────────────

docs: ## Generate documentation (backend)
	cd hotel-app-be && cargo doc --no-deps --document-private-items

# ─── Clean ────────────────────────────────────────────────────────────────────

clean-be: ## Clean backend build artifacts
	cd hotel-app-be && cargo clean

clean-fe: ## Clean frontend build artifacts
	cd hotel-web-fe && rm -rf node_modules dist

clean-desktop: ## Clean desktop build artifacts
	cd hotel-desktop && rm -rf node_modules src-tauri/target

clean-all: clean-be clean-fe clean-desktop ## Clean all build artifacts

clean: clean-all ## Alias for clean-all
