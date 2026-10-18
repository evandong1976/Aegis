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

**Worker B** lives in `aegis_worker_b/` (PLAN.md decision 33): the playbook
(`docs/file_types_vulnerabilities.md`) → fixed tools in a network-off Chalk sandbox → Claude through
the Model Gateway → a report whose every finding is checked against the tool output.

| File                                   | What                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `sandbox_tools.py`                     | The playbook's methods as fixed tools; runs inside the sandbox; never runs the sample              |
| `playbook.py`                          | Reads the md; picks rows and tools by real type and name                                           |
| `agent.py`                             | The tool loop (GPT via the Model Gateway), `submit_report`, evidence check; rules-only baseline |
| `chalk_sandbox.py`                     | Network-off sandbox (no hosts, all routes denied), proven off, upload + SHA-256, terminate         |
| `worker.py`                            | One file in, one result out; what the app runs (`python -m aegis_worker_b.worker`)                 |
| `function.py`                          | Worker B as a Chalk Function (agent code on Chalk Compute)                                         |
| `mcp_server.py`, `mcp_gateway.py`      | The tools over MCP, and the agent calling them through the MCP Gateway                             |
| `samples.py`, `scoring.py`, `evals.py` | Labeled harmless samples, scorers, Chalk Evaluations (agent vs rules)                              |

`pnpm test:chalk` runs the tests locally; `pnpm try:chalk` checks the account end to end.

**Why here and not at the repo root:** `chalk apply` uploads the folder that holds `chalk.yaml`. At
the root that would be the whole repository.

## Two credentials, never mixed

1. **The app's token** — a Chalk service token for one environment, in `.env.local` as
   `CHALK_CLIENT_ID`, `CHALK_CLIENT_SECRET` and `CHALK_ENVIRONMENT` (the environment ID,
   `gswl7f3494e1`). Only the permissions the app needs.
2. **Your developer login** — `chalk login` in a terminal, for deploys, evals and logs. It stays in
   the Chalk CLI's own config and never goes in `.env.local`.

A leaked `.env.local` then can't change the Chalk project.

**Optional: a router key.** `CHALK_ROUTER_API_KEY` (`ck-...`) with its own `CHALK_ROUTER_ENV_ID`, in
`.env.local`, is used for the Model Gateway instead of the service token. It only reaches the router.
The current key is limited to `openai/gpt-6.1-sol` at 1,000,000 tokens a day (one scan is about
7,500). That model rejects function tools on Chat Completions, so `agent.chat_api` sends gpt-6.x
calls through `/v1/responses`. The gateway's quota also needs an output cap on every request, so
nothing calls it without `max_completion_tokens`.

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
