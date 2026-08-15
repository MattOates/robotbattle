# ROBOBATTLE — build, publish, deploy.
#
# Unlike a single-file build, this one ships a directory: the app is
# deliberately code-split so that opening the menu does not download the
# editor. So a deployment is dist/ landing in one directory, and the assets are
# referenced relatively, which is why any URL prefix works with no
# configuration.
#
# Deployment settings are personal and stay out of the repo. Put them in an
# untracked .envrc for direnv (copy .envrc.example, then `direnv allow`), export
# them yourself, or pass them inline:
#   make deploy RB_DEPLOY_HOST=myserver RB_DEPLOY_DIR=/var/www/robobattle

HOST       ?= $(or $(RB_DEPLOY_HOST),example)
REMOTE_DIR ?= $(or $(RB_DEPLOY_DIR),/var/www/robobattle)
URL        ?= $(or $(RB_DEPLOY_URL),https://example.com/robobattle)

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## Install dependencies
	npm install

node_modules: package.json
	npm install
	@touch node_modules

.PHONY: dev
dev: node_modules ## Run the dev server
	npm run dev

.PHONY: check
check: node_modules ## Typecheck only
	npm run check

.PHONY: test
test: node_modules ## Run the test suite
	npm test

.PHONY: build
build: node_modules ## Build dist/
	npm run build
	@echo "built $$(du -sh dist | cut -f1) across $$(find dist -type f | wc -l | tr -d ' ') files -> dist/"

.PHONY: pages
pages: build ## Preview the Pages site locally (CI builds the real one)
	@mkdir -p docs/play
	@rm -rf docs/play/*
	cp -R dist/. docs/play/
	@echo "preview at docs/index.html — publishing is done by CI on push to main"

.PHONY: deploy
deploy: build ## Build, then publish to your own server
	@test "$(HOST)" != "example" || { \
		echo "RB_DEPLOY_HOST is not set — copy .envrc.example to .envrc and run 'direnv allow'"; \
		exit 1; }
	@echo "deploying to $(HOST):$(REMOTE_DIR)"
	ssh $(HOST) 'mkdir -p $(REMOTE_DIR)'
	# --delete clears out chunks from previous builds. Filenames are content
	# hashed, so without it every deploy would leave its predecessors behind.
	rsync -az --delete dist/ $(HOST):$(REMOTE_DIR)/
	@echo "live at $(URL)"

.PHONY: clean
clean: ## Remove build output
	rm -rf dist docs/play _site
