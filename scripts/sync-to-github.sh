#!/bin/bash

# Sync current branch to GitHub mirror repo for multi-platform Tauri builds
# Usage:
#   ./scripts/sync-to-github.sh          # push current branch
#   ./scripts/sync-to-github.sh main     # push specific branch
#   ./scripts/sync-to-github.sh --all    # push all branches + tags

set -e

GITHUB_REMOTE="github"
BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

if ! git remote get-url "$GITHUB_REMOTE" &>/dev/null; then
    echo -e "${RED}Remote '$GITHUB_REMOTE' not found.${NC}"
    echo "Add it with: git remote add $GITHUB_REMOTE git@github.com:<user>/Stirling-PDF.git"
    exit 1
fi

GITHUB_URL=$(git remote get-url "$GITHUB_REMOTE")
echo -e "${BLUE}GitHub mirror:${NC} $GITHUB_URL"

if [ "$BRANCH" = "--all" ]; then
    echo -e "${BLUE}Pushing all branches and tags...${NC}"
    git push "$GITHUB_REMOTE" --all
    git push "$GITHUB_REMOTE" --tags
    echo -e "${GREEN}All branches and tags synced to GitHub.${NC}"
else
    echo -e "${BLUE}Pushing branch:${NC} $BRANCH"
    git push "$GITHUB_REMOTE" "$BRANCH"
    echo -e "${GREEN}Branch '$BRANCH' synced to GitHub.${NC}"
fi

echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "  - View builds: https://github.com/$(echo "$GITHUB_URL" | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo "  - Manual trigger: Go to Actions → 'Build Tauri Applications' → Run workflow"
