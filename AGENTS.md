# Agent Instructions

## Commit Convention

Use this commit format:

```text
xxx(comp): desc
```

- `xxx` is a lowercase change type such as `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, or `chore`.
- `comp` is the focused component or area, such as `cli`, `config`, `predictions`, `files`, `models`, `deployments`, `trainings`, `skill`, `docs`, or `tests`.
- `desc` is a concise imperative description in English, without a trailing period.

Examples:

```text
fix(predictions): allow explicit model versions
feat(files): add artifact download validation
docs(agents): document commit convention
```

Batch commits by coherent intent. Keep runtime changes, tests, docs, and generated build output in separate commits when that makes review easier.
