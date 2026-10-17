# chalk/ — Aegis's Chalk project

Everything Chalk-side lives here (MEGA_PROMPT §4 layout, §5.6; `docs/PLAN.md` › Sponsor findings ›
Chalk). Chalk is milestone 6 (Evan). Nothing here is built yet; these are the files `chalk init`
wrote (Zach, 2026-10-17), moved out of the repo root.

| File                        | What                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `chalk.yaml`                | The project (`Default`), one environment block (`default`, Python 3.12)                                          |
| `pyproject.toml`, `uv.lock` | Python dependencies: `chalkcompute` (sandboxes, evaluations) and `chalkpy` (features, resolvers, prompts)        |
| `.chalkignore`              | What `chalk apply` leaves out (it also respects `.gitignore`)                                                    |
| `CLAUDE.md`                 | Chalk's generated guide for coding agents. Reference only: where it disagrees with `docs/PLAN.md`, the plan wins |

Coming here: the `Domain` / `Url` features and resolvers (link scoring), the Worker B helper (a
Chalk Compute sandbox per risky file), and the eval datasets and scorers behind the Accuracy tab.

**Why here and not at the repo root:** `chalk apply` uploads the folder that holds `chalk.yaml`. At
the root that would be the whole repository.

## Two credentials, never mixed

1. **The app's token** — a Chalk service token for one environment, in `.env.local` as
   `CHALK_CLIENT_ID`, `CHALK_CLIENT_SECRET` and `CHALK_ENVIRONMENT` (the environment ID,
   `gswl7f3494e1`). Only the permissions the app needs.
2. **Your developer login** — `chalk login` in a terminal, for deploys, evals and logs. It stays in
   the Chalk CLI's own config and never goes in `.env.local`.

A leaked `.env.local` then can't change the Chalk project.

## Setup

```bash
curl -s -L https://api.chalk.ai/install.sh | sh
```

```bash
chalk login
```

Then work from this folder (`cd chalk`): `uv sync` for the Python environment, `chalk apply` to
deploy. The CLI isn't installed on Evan's Mac yet, so running from `chalk/` instead of the root is
still to be confirmed with the first `chalk apply`.

## Worker B's sandbox must have its network off

Chalk sandboxes on the default `host` compute class have **outbound network open by default**
(Chalk's guide, `CLAUDE.md` › Sandboxes › Networking). Worker B must pass a `NetworkPolicy` that
allows no hosts, and `scripts/try-chalk` must prove the network is really off — the same probes
`try-daytona` runs — before any sample goes in (MEGA_PROMPT §6 rule 2).
