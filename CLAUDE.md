# Workspace conventions

This folder is a Glade workspace. Every Glade task's agent runs in this folder.

- Each task keeps its files in `tasks/<task-id>-<slug>/` under this folder, where `<slug>` is a short kebab-case
  form of the task's title.
- When a task needs a git worktree, create it inside the task's folder.
- Leave other tasks' folders alone.

# Working on Nekomata

- Each change lands as its own branch and PR. Don't merge your own PR; it's reviewed first.
- PR descriptions and commit messages are brief, in this shape, under a short imperative subject:

  ```
  Because:
  - reason

  This commit:
  - change
  ```
- `node --test` must pass. A change meant to alter what an art style draws regenerates that
  style's golden file (`UPDATE_GOLDEN=1 node --test test/scene.test.mjs`) and posts renders
  on the PR (`node tools/scene-shot.mjs --style <id>`).
- **Kittens use the nekomata-team GitHub App for every `gh` call:** run
  `node scripts/gh-team.mjs <gh args>` (e.g. `node scripts/gh-team.mjs pr create …`). Never
  fall back to Jared's own `gh` login; if the script fails, stop. The app's config lives
  outside the repo in `~/.config/nekomata-team/`.
- Kittens commit as the app too:
  `git -c user.name='nekomata-team[bot]' -c user.email='337087438+nekomata-team[bot]@users.noreply.github.com' commit …`
