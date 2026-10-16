# Aegis: Brainstorm

A background app that watches Chrome for dangerous links and downloads. It checks links to see whether they're legit and what they do. It sends downloads to a sandbox (Docker) so they never run, and reverse engineers them to show the code that causes problems.

## The core pitch

Most antivirus tools only check a file after it's on your machine, and only against known bad files. Aegis checks links and downloads *before* they reach you, and explains what they would do in plain English. It shows the user the actual suspicious code, not just "Threat detected."

## Links: ways to decide whether one is legit

- **Mismatch:** the link text says `chase.com` but the `href` goes to `chase-secure-login.xyz`. This is cheap to check and looks great in a demo.
- **Lookalikes:** `paypa1.com`, `rnicrosoft.com`, Cyrillic letters disguised as Latin (punycode). Compare against a list of the top ~1000 brands.
- **Domain age:** a domain registered 3 days ago that asks for a password is almost always phishing. RDAP lookups are free.
- **Google Safe Browsing:** we have a key, so use it as the "known bad" baseline.
- **"What happens" (detonation):** open the link in a throwaway headless browser and record:
  - the redirect chain
  - the final page and a screenshot
  - whether it starts a download
  - whether it shows a password form on a domain that doesn't match the brand
  - which other hosts it contacts
- **Shortened links:** bit.ly and similar hide the destination. Detonation reveals it, so we can show "this short link actually goes to…" before the user clicks.

## Downloads: what "reverse engineer" can mean

These go roughly from quick and impressive to deep:

1. **Real file type vs. name:** `invoice.pdf.exe`, or a `.pdf` that is really an executable.
2. **Scripts** (`.js`, `.ps1`, `.vbs`, `.sh`, Office macros): show the code with the dangerous lines highlighted, such as `curl | sh`, base64 decoding followed by running the result, or writing to LaunchAgents. This most directly answers "see the code that causes an issue."
3. **Installers** (`.pkg`, `.dmg`, `.msi`): pull out the preinstall and postinstall scripts. A lot of real Mac malware hides there.
4. **Binaries:**
   - imports and strings: URLs, IPs, keychain access, crypto wallet paths
   - packed or high-entropy sections
   - Mandiant **capa** to list capabilities ("captures keystrokes", "persists at login")
5. **LLM explanation:** send all of that evidence to a model that writes "This file does X, Y, Z, so we recommend…". That gets a great "wow" moment for very little work.

## Ways to stand out at a hackathon

- **A "what would have happened" timeline:** "If you'd run this, it would have: ① downloaded a second stage from X, ② added itself to login items, ③ read your Chrome passwords."
- **Show the code:** put the decompiled or extracted snippet on screen with the dangerous lines highlighted. Judges love seeing the code.
- **A safe-preview mode:** let the user view the downloaded PDF or document as images rendered in the sandbox, so they never open the real file.
- **Risk score plus reasons**, never just a verdict.

## Open questions

- **Who is it for?** Non-technical users (simple verdicts) or security folks (full reports)? This decides the UI.
- **Mac malware, Windows malware, or both?** Truly *running* Windows malware on a Mac is hard. Static analysis covers both platforms well.
- **Block or warn?** Holding every download until the scan finishes is safer but slows the user down. We could scan small files and executables only and let images through.
- **Downloads that need a login:** if the sandbox downloads the file again, it won't have the user's cookies. Should Chrome download it, with the file going straight into quarantine instead?
- **Demo safety:** use test samples such as the EICAR test file, harmless "malicious-looking" scripts we write ourselves, and phishing pages from public feeds. Don't use live malware on stage.

## A realistic weekend scope

- **Must-have:**
  - the extension that flags links
  - the link heuristics plus Safe Browsing
  - downloads sent to Docker for static analysis
  - the script and installer code view with highlights
  - an LLM summary
- **Nice to have:** link detonation with screenshots, and capa for binaries.
- **Stretch:** dynamic runs of Linux or macOS samples.

## Decisions so far

- **Project folder:** `Aegis`
- **Stack:** an Electron background app plus a Python worker for analysis
- **Sandbox:** Docker container, with no network during analysis and thrown away after each scan
- **Threat intel:** Google Safe Browsing
