set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# List available recipes
default:
    @just --list

# Run the app. Targets: dev (both, HMR), backend, frontend
run target="dev":
    & "{{justfile_directory()}}/scripts/dev.ps1" -Target {{target}}

# Backend tests. Optional pytest args: just test-backend "-k cycle"
test-backend *args:
    cd backend; uv run pytest {{args}}

# Frontend tests. Optional vitest args: just test-frontend '-t "assigns increasing ranks"'
test-frontend *args:
    cd frontend; npx vitest run {{args}}

# Everything: typecheck + both suites
test: typecheck test-backend test-frontend

# tsc -b && vite build -- the only type check in the project
typecheck:
    cd frontend; npm run build

# Production frontend bundle (serve by pointing ROADMAP_STATIC_DIR at frontend/dist)
build:
    cd frontend; npm run build

# Seed six apps. Pass --reset to drop every app first.
seed *args:
    cd backend; uv run --env-file ../.env python scripts/seed.py {{args}}

# Install backend and frontend dependencies
install:
    cd backend; uv sync
    cd frontend; npm install
