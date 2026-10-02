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
- **Every change that ships bumps the version, in the same PR:** `version` in
  `extension/package.json` (the Glade plugin's manifest takes it from there). A fix or a tweak
  to a style is a patch (1.1.0 to 1.1.1); a new style or setting is a minor. Once the PR has
  merged, tag that version on `main` (`git tag -a v1.1.1 -m … && git push origin v1.1.1`): CI
  builds the `.vsix` and attaches it to a GitHub release. Glade only reloads a plugin whose
  version changed, and anyone comparing an install with `main` goes by the number, so an
  unbumped change looks like no change. Docs, tests and CI alone don't need a bump.
- Don't add a "Generated with Claude Code" line to PR descriptions, commit messages or
  comments.
- **Kittens use the nekomata-team GitHub App for every `gh` call:** run
  `node scripts/gh-team.mjs <gh args>` (e.g. `node scripts/gh-team.mjs pr create …`). Never
  fall back to Jared's own `gh` login; if the script fails, stop. The app's config lives
  outside the repo in `~/.config/nekomata-team/`.
- Kittens commit as the app too:
  `git -c user.name='nekomata-team[bot]' -c user.email='337087438+nekomata-team[bot]@users.noreply.github.com' commit …`
