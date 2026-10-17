#!/bin/sh
# Harmless execution fixture. Finder opens executable .command files in Terminal.
# In a headless sandbox, run with sh and capture stdout instead.

printf '%s\n' \
  '============================================================' \
  'AEGIS DEMO: A downloaded script was executed.' \
  'An untrusted script could have performed harmful actions here.' \
  'This demo only prints this message. It makes no changes.' \
  'AEGIS_DEMO_EXECUTED' \
  '============================================================'

exit 0
