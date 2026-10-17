# Aegis analysis sandbox image (architectural.md §3.6, MEGA_PROMPT §5.3).
#
# One image for both the Daytona snapshot (milestone 3) and the local Docker fallback (milestone 8,
# MEGA_PROMPT §5.9). It holds the tools only: entry.py, analyze.py, observe.py, detonate.py and the
# YARA rules arrive with milestones 3 and 7.
#
#   docker build -t aegis-sandbox sandbox/
#   docker run --rm --network none aegis-sandbox python /opt/aegis/selftest.py
#
# Daytona runs linux/amd64; build the snapshot with --platform linux/amd64.

FROM python:3.12.14-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    CAPA_RULES=/opt/capa-rules

# Native tools: 7z unpacks zip, xar (.pkg) and most .dmg images; cpio opens .pkg payloads and
# install scripts; libmagic gives the real file type; binutils has strings and objdump.
RUN apt-get update \
 && apt-get install -y --no-install-recommends p7zip-full cpio libmagic1 file binutils \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Headless Chromium and its system libraries, for link detonation (milestone 7).
RUN playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

# capa rules for the capa release in requirements.txt, checked against a known SHA-256.
ARG CAPA_RULES_VERSION=9.4.0
ARG CAPA_RULES_SHA256=273591b11737181b3bdaac18964f23627cf10c21c2b143fc9be88e4a33217669
COPY fetch_capa_rules.py /tmp/fetch_capa_rules.py
RUN python /tmp/fetch_capa_rules.py && rm /tmp/fetch_capa_rules.py

COPY selftest.py /opt/aegis/selftest.py

# Samples are examined by an unprivileged user. A job uploads the file to /sample (§5.3) and
# results go to /out.
RUN useradd --create-home --uid 10001 analyst \
 && mkdir -p /sample /out \
 && chown analyst:analyst /sample /out
USER analyst
WORKDIR /sample
