# Harmless terminal demo

`aegis-terminal-demo.command` is a macOS Terminal script. When executable and
opened in Finder, it opens Terminal and prints a clearly labeled demo message.
It only uses shell built-ins, makes no network requests, reads no user files,
and writes no files. It exits successfully without waiting for input.

Downloading alone does not execute it. Opening it is a separate user action,
and macOS security controls may block a downloaded script. Browser downloads
also generally do not preserve executable permissions. For a controlled manual
demo, prepare a trusted local copy with
`chmod +x demo/aegis-terminal-demo.command` before opening it. Do not disable
macOS security controls for the demonstration.

## Download interception demonstration

Serve this directory with `python3 -m http.server 8765 --bind 127.0.0.1 --directory demo`
from the repository root, then use the following URL as the download target:

<http://127.0.0.1:8765/aegis-terminal-demo.command>

Your download handler should hold the file before user launch, transfer its
bytes to the isolated container, and invoke `sh /sample/aegis-terminal-demo.command`
there (adjust the path to the uploaded location). A Linux container cannot open
macOS Terminal; captured output demonstrates execution there instead.

Expected observations:

- stdout contains `AEGIS_DEMO_EXECUTED`.
- Exit code is `0`.
- No files are created by the sample and no network connections are attempted.

This fixture demonstrates executable-content interception and sandbox execution,
not malware detection. A behavioral scanner can reasonably report it as clean.
If the presentation needs a guaranteed hold, use an explicitly labeled demo policy
that holds shell scripts rather than claiming the sample contains malware.

These files do not implement or verify the application's download interception.
