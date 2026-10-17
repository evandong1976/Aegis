"""Image build step: downloads the capa rules release, checks its SHA-256 and unpacks it.

Reads CAPA_RULES_VERSION, CAPA_RULES_SHA256 and CAPA_RULES (the target folder) from the environment.
"""

import hashlib
import io
import os
import tarfile
import urllib.request

version = os.environ["CAPA_RULES_VERSION"]
expected = os.environ["CAPA_RULES_SHA256"]
target = os.environ["CAPA_RULES"]

url = f"https://github.com/mandiant/capa-rules/archive/refs/tags/v{version}.tar.gz"
data = urllib.request.urlopen(url, timeout=120).read()
digest = hashlib.sha256(data).hexdigest()
if digest != expected:
    raise SystemExit(f"capa-rules v{version}: checksum {digest}, expected {expected}")

with tarfile.open(fileobj=io.BytesIO(data)) as tar:
    for member in tar.getmembers():
        _, _, rest = member.name.partition("/")  # drop the capa-rules-<version>/ prefix
        if rest:
            member.name = rest
            tar.extract(member, target, filter="data")
print(f"capa-rules v{version} unpacked to {target}")
