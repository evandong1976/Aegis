## Inspiration

Most antivirus software checks a file only after it's already on your computer, and only if someone has seen that exact file before. When it does catch something, all you're told is "Threat detected." You don't learn what the file would have done, or why the link was a trap, so you're no better at spotting the next one.

We wanted a tool that steps in *before* the click lands and shows you what's behind it: the line of code that would have added itself to your login items, or the link that says `chase.com` but goes to `chase-secure-login.xyz`.

## What it does

Aegis is a macOS menu bar app with a Chrome extension. Every link you see and every file you download gets one of four verdicts: **Malicious**, **Suspicious**, **Unknown** or **Clean**. Anything dangerous is held before it reaches your Mac.

- **Links are judged without ever being opened.** Aegis catches lookalike domains (`paypa1.com`, Cyrillic letters posing as Latin ones) and link text that doesn't match where the link goes. It looks up domain age (a three-day-old domain asking for a password is almost always phishing) and checks DNS, certificate history, Google Safe Browsing and public phishing feeds. Flagged links get a red border. Clicking one opens a guard where you can go back, continue or trust the site.
- **Downloads are caught in memory before they're written to disk.** Plain documents and real media are checked on the Mac and never uploaded. Scripts, programs, installers and risky documents go to a throwaway Daytona sandbox that is cut off from the network from the moment it's created.
- **You can watch the file run.** The main window shows the sandbox live: a Terminal tab streams the trace of the file running, with blocked network attempts in red, and a Desktop tab shows the file actually opening on the sandbox's own Linux desktop. When the run ends, the live view turns into a Report with the suspicious lines, a plain-English "what would have happened" timeline, and the full sandbox log as evidence.

Aegis never calls anything "safe". When we don't have the evidence, the honest answer is **Unknown**, and Unknown files are held.

## How we built it

- **App:** Electron, React 19, TypeScript and Tailwind v4, with a local SQLite store (`node:sqlite`). It lives in the menu bar and has a mini panel (opened with fn or ⌃⌥A) plus a main window: Overview, Links, Downloads, Messages, Accuracy, Settings, and a Report for every verdict. Every screen is built from a design system we made in Figma first: one token file, contrast checked in both themes, and verdicts that always keep their icon and word, never colour alone.
- **Chrome extension (Manifest V3):** a content script scans each page's links, including plain-text URLs and pages that change as you use them, like Gmail. The service worker holds every download at `onDeterminingFilename`, cancels it, and has an offscreen document fetch the bytes in memory with your cookies, so downloads that need a login still work. The bytes go to the app over a local bridge that accepts only our extension's ID.
- **Link engine:** rules for lookalikes, digit swaps, homoglyphs, redirect unwrapping and mismatched link text. On top of those, Google Safe Browsing (with tokens stripped from URLs), URLhaus and OpenPhish feeds downloaded hourly and matched on the Mac, RDAP for domain age, DNS (including fast-flux detection) and Cert Spotter. Each page gets an answer within a 1.5 s budget.
- **Sandbox:** every risky file gets a fresh Daytona sandbox created with `networkBlockAll`. Inside the sandbox we check the file's SHA-256, run it under a time limit, and probe the network to prove it's really off. The sandbox is deleted in a `finally` block, at most three run at once, and there's a daily budget. For the Desktop tab we use Daytona's Computer Use to start a desktop inside the network-off sandbox.
- **AI analyst:** Factory Droid runs on the Mac, never in the same machine as the file. We switched off every built-in tool we could (31 of them). What's left is a handful of fixed, read-only, argument-free commands that run inside the sandbox. A permission handler cancels anything else, every tool output is fenced off as untrusted data, and Droid returns a schema-validated verdict, timeline and summary. A malicious file can't talk its way to a clean verdict, because the AI is only allowed to *raise* the verdict our rules produce, never lower it. If $v_{\text{rules}}$ is the rule-based verdict and $v_{\text{AI}}$ is the analyst's, with the four verdicts ordered by severity, the final verdict is

$$
v = \max\left(v_{\text{rules}},\; v_{\text{AI}}\right), \qquad \text{Clean} < \text{Unknown} < \text{Suspicious} < \text{Malicious}.
$$

- **Evidence over claims:** every "it works" in our docs points to a run saved in `logs/`, with screenshots. That includes 198 passing unit tests, 26/26 end-to-end download checks with the real app, headless Chrome and live Daytona, and a leak check confirming 0 sandboxes left behind after every run.

## Challenges we ran into

- **Default network settings that changed under us.** On our first Daytona account, sandboxes were restricted to a few essential services by default. Partway through, the account moved to a higher tier, and a sandbox with no network setting suddenly had the whole internet. Because every Aegis sandbox already set `networkBlockAll` at creation and our probes verified it, nothing leaked. The lesson stuck: never trust a default, and prove isolation by probing it. We also caught in Chalk's docs that its sandboxes allow outbound traffic by default, before we built on the assumption that they didn't.
- **Chrome doesn't really pause downloads.** A paused small download still finished once its filename was settled, so we moved the hold to `onDeterminingFilename`, where Chrome actually waits. Chrome also refuses save paths that start with a dot, and it leaves the `Origin` header off an extension's GET requests, so our bridge was rejecting its own extension. Every bridge route became POST.
- **Locking down an AI agent.** The Droid SDK and CLI spoke different protocol versions, so we started the tool server ourselves and connected the CLI to it directly. One tool, `ToolSearch`, can't be switched off, so we proved it can only load tool schemas and allowed it as the single exception.
- **A desktop in a box with no network.** To get a terminal window to open on the sandbox's desktop, we needed `setsid -f`, `--disable-server` (there's no D-Bus session), and every argument spelled out, because the sandbox's shell wouldn't split a variable into words.
- **Two people, one pipeline.** We worked on separate feature branches and ended up with two sandbox paths, one for real downloads and one for the live view. They now sit side by side and are being merged into one.

## Accomplishments that we're proud of

- A real file, intercepted from a real Chrome download, never written under its own name on the Mac, and run in a sandbox that provably can't reach the internet.
- Watching our fake Zoom installer write a LaunchAgent, look for passwords and try to upload them, all live on the sandbox's desktop, while every network attempt fails.
- An AI analyst that is useful but can't be turned against the user: fixed tools, untrusted output, and a verdict it can only make stricter.

## What we learned

- Isolation is something you test, not something you configure once. Our network probes went from 36 s to 8 s once we ran all six at the same time, so it became cheap to check on every run.
- "Unknown" is a feature. Saying so when the evidence is missing builds more trust than a confident wrong "Clean".
- Showing the code is what makes security make sense to people. "This line writes to `~/Library/LaunchAgents`" teaches more than any risk score.

## What's next for Aegis

- **Connecting Droid's live session** to the live view. Today the tool calls are real and run in the real sandbox, but Droid's narration there is a labelled stand-in, and real downloads are held as Unknown until the analyst is connected.
- **A second, independent analyst in a Chalk Compute sandbox.** When the two analysts disagree, the more severe answer wins: $v_{\text{AI}} = \max(v_A, v_B)$.
- **Headless Ghidra** inside the sandbox for compiled programs.
- **iMessage verdicts through Photon:** send Aegis a screenshot of a suspicious text and get back each link's real domain and a one-line reason.
- **An Accuracy tab** backed by evals that measure each analyst on its own and both together.

---

*Pre-event code: the fn-key listener (`native/fn-key`) is adapted from Klair's fn-key add-on, which was written before the event.*
