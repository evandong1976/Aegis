"""Worker B deployed as a Chalk Function: the agent code runs on Chalk Compute, not on the Mac.

The Function has a Chalk workload identity (chalk_identity=True), so inside it the agent reaches
the Model Gateway and creates the sample's sandbox with no client secret or provider key. The
sample itself still goes into its own network-off sandbox; the Function never runs it.

Deploys when this module is imported. Keep side effects under `__main__`.
    cd chalk && uv run --env-file ../.env.local python -m aegis_worker_b.function   # deploy + smoke
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import chalkcompute

from aegis_worker_b import playbook

FUNCTION_NAME = "aegis-worker-b"

_here = Path(__file__).resolve().parent
image = (
    chalkcompute.Image.debian_slim("3.12")
    .pip_install(["openai==3.24.0", "chalkcompute"])
    .add_local_python_source("aegis_worker_b")
    .add_local_file(playbook.load_path(), "/opt/aegis/playbook.md", strategy="copy")
)

# With a router key in the deploying shell (.env.local), the Function uses it too: the key goes up
# as a Chalk secret, never into the image. Without one it uses the workload identity.
_router = os.environ.get("CHALK_ROUTER_API_KEY")
router_secrets = [chalkcompute.Secret.from_local_env("CHALK_ROUTER_API_KEY")] if _router else []
router_env = {k: os.environ[k] for k in ("CHALK_ROUTER_ENV_ID", "AEGIS_CHALK_MODEL") if _router and os.environ.get(k)}


@chalkcompute.function(
    name=FUNCTION_NAME,
    image=image,
    chalk_identity=True,
    secrets=router_secrets,
    env=router_env,
    cpu="1",
    memory="2Gi",
    concurrency=3,
)
def aegis_worker_b(filename: str, data_b64: str) -> str:
    """One file → Worker B's result as JSON (see worker.run)."""
    from aegis_worker_b.worker import run

    return json.dumps(run(filename, base64.b64decode(data_b64)))


@chalkcompute.function(name="aegis-refresh-known-hashes", image=image, chalk_identity=True, schedule="1h")
def aegis_refresh_known_hashes() -> None:
    """Hourly: MalwareBazaar's recent samples → the aegis_known_bad_hashes dataset (threat_intel.py)."""
    from aegis_worker_b.threat_intel import refresh

    refresh()


if __name__ == "__main__":
    from aegis_worker_b.samples import by_name

    aegis_worker_b.wait_ready()
    s = by_name()["sh-dropper"]
    res = json.loads(aegis_worker_b.remote(s.filename, base64.b64encode(s.data).decode()))
    print(json.dumps({k: res.get(k) for k in ("sandbox_id", "error", "analyst_error", "ms")}, indent=2))
    print(json.dumps(res.get("analysis", {}).get("verdict")), res.get("analysis", {}).get("summary"))
