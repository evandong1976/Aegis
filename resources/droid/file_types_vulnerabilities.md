# File Types, Vulnerabilities, and Discovery Methods

The key is to go from **file type → attack surface → testing method → confirmed vulnerability**.

## 1. File types and vulnerabilities to investigate

| File type | Common vulnerabilities | Methods to discover them |
|---|---|---|
| `.c`, `.cpp`, `.h` | Buffer overflow, use-after-free, double-free, integer overflow | Static analysis, AddressSanitizer (ASan), GDB, fuzzing |
| `.py` | Command injection, unsafe deserialization, path traversal | Code review, Bandit, Semgrep, controlled input testing |
| `.js`, `.ts` | XSS, prototype pollution, injection, insecure dependencies | ESLint security rules, Semgrep, dependency auditing, browser testing |
| `.php` | SQL injection, file inclusion, command injection | Code review, Semgrep, authorized dynamic testing |
| `.sql` | SQL injection, excessive permissions, insecure queries | Query review, parameterization checks, database permission audits |
| `.json` | Mass assignment, unsafe deserialization, excessive trust in user input | Schema validation, boundary testing, parser review |
| `.xml` | XXE, entity expansion, unsafe external resource resolution | XML parser configuration review, safe test documents |
| `.yaml`, `.yml` | Unsafe deserialization, insecure CI/CD configuration, secret exposure | Configuration scanning, parser review, secret scanning |
| `.zip`, `.tar`, `.gz` | Zip Slip, archive bombs, path traversal | Inspect archive paths, extraction testing in an isolated environment |
| `.pdf` | Embedded malicious content, parser vulnerabilities, JavaScript actions | Metadata inspection, static scanning, sandboxed parsing |
| `.docx`, `.xlsx`, `.pptx` | Malicious macros or embedded objects, XML parser issues, external relationships | Inspect OOXML contents, scan relationships and embedded files |
| `.jpg`, `.png`, `.svg` | Parser vulnerabilities, SVG script injection, malformed-image handling | Metadata inspection, SVG sanitization review, image decoder fuzzing |
| `.env`, `.config`, `.ini` | Exposed credentials, insecure settings, debug mode | Secret scanning, configuration review, permission checks |
| `.sh`, `.bash`, `.ps1` | Command injection, unsafe permissions, insecure temporary files | ShellCheck, static analysis, input-flow review |
| `.pem`, `.key`, `.p12` | Exposed private keys, weak cryptographic configuration | File permission checks, secret scanning, certificate/key inspection |
| `.wasm`, `.so`, `.dll`, `.exe` | Memory corruption, unsafe exports, insecure APIs, outdated components | Binary analysis, fuzzing, symbol inspection, dependency scanning |

> **Important:** A file extension does not establish a vulnerability. For example, a `.json` file is not inherently vulnerable to deserialization attacks; the risk depends on how the program parses and uses its contents.
