#!/usr/bin/env python3
"""gnosis-secretscan - deterministic, stdlib-only secret detector for the wiki repo.

ONE scanner, THREE call sites:
  1. write-time inside gnosis.py / reconcile.py (block a write before it touches the wiki)
  2. a client-side pre-push hook on both machines
  3. a GitHub Action = required PR status check (the authoritative backstop)

Design:
  - Deterministic (no network). Portable pure stdlib (Windows + Spark container).
  - Fails CLOSED: exit 2 on a hit; exit 1 on ANY incomplete/failed scan (a git error,
    an unreadable blob, an unparsable range) — never report "clean" when coverage is
    partial. Exit 0 only when the FULL requested set scanned with zero hits.
  - Modes: `<file>...` | `--staged` | `--range BASE..TIP` (all NUL-safe; filenames with
    spaces are the norm in this wiki, so name lists are parsed with -z, never whitespace).
  - `--range` scans EVERY blob newly reachable from TIP but not BASE (incl. intermediate
    commits + renames/copies), not just the endpoint tree.

Allowlist: a line may opt out with `# secretscan:allow <reason>` — the reason is REQUIRED,
and it only suppresses ANNOTATABLE rules (never live private/cloud keys).
"""
import sys
import re
import subprocess

# (name, compiled regex, annotatable?) — annotatable=False can NEVER be allowlisted.
RULES = [
    ("google-api-key",      re.compile(r"AIza[0-9A-Za-z_\-]{35}"),                        False),
    ("aws-access-key",      re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),                 False),
    ("aws-secret-key",      re.compile(r"(?i)aws_secret_access_key\s*[=:]\s*['\"]?[0-9A-Za-z/+]{40}"), False),
    ("github-pat",          re.compile(r"gh[pousr]_[0-9A-Za-z]{36,}"),                    False),
    ("github-fine-pat",     re.compile(r"github_pat_[0-9A-Za-z_]{60,}"),                  False),
    ("slack-token",         re.compile(r"xox[baprs]-[0-9A-Za-z\-]{10,}"),                 False),
    ("stripe-live",         re.compile(r"sk_live_[0-9A-Za-z]{20,}"),                      False),
    ("openai-key",          re.compile(r"sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}"),     False),
    ("private-key",         re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA |ENCRYPTED )?PRIVATE KEY-----"), False),
    ("google-oauth-secret", re.compile(r"GOCSPX-[0-9A-Za-z_\-]{20,}"),                    False),
    ("jwt",                 re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"), False),  # non-annotatable (Codex re-review): a real JWT must not be suppressible
    # generic secret-ish assignment. Key name may be quoted (JSON) and/or prefixed/suffixed
    # (client_secret, OPENAI_API_KEY, refresh_token). Value = group 1.
    ("generic-secret-assign",
     re.compile(r"""(?ix)
        ["']?[\w.\-]{0,24}
        (?:api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key)
        [\w.\-]{0,24}["']?
        \s*[:=]\s*
        ["']?([^\s"',;]{20,})"""),
     False),   # non-annotatable (Codex F5): a real generic secret must not be suppressible by `secretscan:allow`
]

# A captured VALUE that IS a placeholder / code reference (fullmatch on the value ONLY, so a
# real secret that merely CONTAINS "example" is still caught).
# Narrowed twice per Codex: NO broad `example*` wildcard (only exact placeholder words) and
# NO raw ALL-CAPS exemption (a 2–61-char ALL-CAPS value could be a real secret). Env-var
# citations must be written as a code reference — `${VAR_NAME}` — which matches the ${...}
# form below; a bare `VAR_NAME` value after a secret keyword is now (correctly) flagged.
PLACEHOLDER_VALUE = re.compile(r"""(?ix)^(
    your[_-][\w\-]* |
    example(?:[_-](?:key|value|token|secret|id|string|password))? |
    placeholder[\w\-]* | x{3,} | \.{3,} | <[^>]*> |
    \$\{?[a-z_][\w]*\}? |
    (?:os\.environ|getenv|process\.env|env|config|settings|self|cls)\.[\w.]+ |
    \$\{[A-Za-z_][\w]*\} |
    [\w~:/\\.\-]*master\.env |
    redacted | dummy[\w\-]* | test[_-]?key[\w\-]* | sk_test_[\w]*
)$""")

ALLOW = re.compile(r"#\s*secretscan:allow\s+(\S.+)")   # reason (group 1) is REQUIRED

SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip",
            ".gz", ".tar", ".db", ".sqlite", ".woff", ".woff2", ".ttf", ".mp4",
            ".docx", ".xlsx", ".pptx"}

SUBPROC_TIMEOUT = 120           # seconds; a git call that hangs => fail closed (Codex F5)
MAX_BLOB = 50 * 1024 * 1024     # 50 MiB DoS guard; legit large text (data manifests) still
                                # scans; anything larger is un-scannable data => fail closed


class ScanError(Exception):
    """Any condition that makes the scan INCOMPLETE — must fail closed (exit 1)."""


def _decode_text(data, path):
    """Bytes -> text for scanning, or fail CLOSED (Codex F5). A non-SKIP_EXT blob that is
    oversized, NUL-bearing (binary), or not valid UTF-8 cannot be reliably line-scanned —
    previously it was decoded with 'replace' and could hide a secret. Now it BLOCKS."""
    if len(data) > MAX_BLOB:
        raise ScanError(f"{path}: {len(data)} bytes exceeds scan cap {MAX_BLOB} — failing closed")
    if b"\x00" in data:
        raise ScanError(f"{path}: contains NUL (binary content) — cannot text-scan, failing closed")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise ScanError(f"{path}: not valid UTF-8 ({e}) — cannot reliably scan, failing closed")


def mask(tok):
    tok = tok.strip().strip("'\"")
    if len(tok) <= 8:
        return "*" * len(tok)
    return tok[:4] + "…" + tok[-2:] + f"<{len(tok)}ch>"


def scan_text(text, path):
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        am = ALLOW.search(line)
        allowed = bool(am and am.group(1).strip())     # allow only with a real reason
        for name, rx, annotatable in RULES:
            for m in rx.finditer(line):                 # ALL matches, not just the first
                captured = (m.group(1) if m.groups() else m.group(0))
                if name == "generic-secret-assign":
                    # Strip only WRAPPING quotes/backticks — NOT trailing sentence
                    # punctuation (Codex: stripping `.` let `example_password....` reduce to
                    # an exact placeholder). A value that is a code reference still matches.
                    val = re.sub(r"^['\"`]+|['\"`]+$", "", captured.strip())
                    if PLACEHOLDER_VALUE.fullmatch(val):  # value IS a placeholder/code ref
                        continue
                if allowed and annotatable:
                    continue
                hits.append((path, i, name, mask(captured)))
    return hits


def _run(args):
    """subprocess.run wrapper: a hang => ScanError (fail closed, Codex F5)."""
    try:
        return subprocess.run(args, capture_output=True, timeout=SUBPROC_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise ScanError(f"{' '.join(args[:3])}… timed out after {SUBPROC_TIMEOUT}s")


def _git(args):
    r = _run(["git"] + args)
    if r.returncode != 0:
        raise ScanError(f"git {' '.join(args)} failed rc={r.returncode}: "
                        f"{r.stderr.decode('utf-8', 'replace').strip()}")
    return r.stdout


def _scan_blob(sha, path):
    r = _run(["git", "cat-file", "blob", sha])
    if r.returncode != 0:
        raise ScanError(f"cat-file blob {sha} ({path}) failed")
    return scan_text(_decode_text(r.stdout, path), path)


def scan_paths(paths):
    hits = []
    for path in paths:
        if any(path.lower().endswith(e) for e in SKIP_EXT):
            continue
        try:
            with open(path, "rb") as f:
                data = f.read()
        except IsADirectoryError:
            continue
        except (FileNotFoundError, PermissionError, OSError) as e:
            raise ScanError(f"cannot read {path}: {e}")   # unreadable target != clean
        hits += scan_text(_decode_text(data, path), path)
    return hits


def scan_staged():
    # --no-renames so a rename to a secret-bearing filename surfaces as an Add (Codex re-review)
    out = _git(["diff", "--cached", "-z", "--no-renames", "--name-only", "--diff-filter=ACMT"])
    hits = []
    for pb in out.split(b"\0"):
        if not pb:
            continue
        path = pb.decode("utf-8", "replace")
        # authoritative gate: do NOT skip by extension (Codex re-review) — a secret in a
        # committed binary must fail closed via _decode_text, not slip through unscanned.
        hits += scan_text(path, f"<path:{path}>")   # secret in a filename
        # staged blob sha via ls-files --stage keeps NUL paths intact
        ls = _git(["ls-files", "--stage", "-z", "--", path])
        rec = ls.split(b"\0", 1)[0].decode("utf-8", "replace").split()
        if len(rec) < 2:
            raise ScanError(f"no staged blob for {path}")
        hits += _scan_blob(rec[1], path)
    return hits


def scan_range(rng):
    zero = "0" * 40
    if ".." in rng:
        base, tip = rng.split("..", 1)
    else:
        base, tip = "", rng
    tip = (tip or "HEAD").strip()
    base = base.strip()
    # Enumerate every blob reachable from TIP but not from a TRUSTED exclusion base (covers
    # intermediate commits, renames, copies). CRITICAL (Codex F4): never exclude by
    # `--remotes` — on a freshly-created/pushed branch the just-created remote ref makes
    # `tip --not --remotes` empty, scanning ZERO objects and returning a vacuous green.
    def _commit_ok(ref):
        return _run(["git", "cat-file", "-e", ref + "^{commit}"]).returncode == 0
    if base and base != zero and _commit_ok(base):
        excl = base                                       # caller gave a real base
    else:
        mb = _run(["git", "merge-base", tip, "origin/main"])
        if mb.returncode == 0 and mb.stdout.decode().strip():
            excl = mb.stdout.decode().strip()             # fork point from protected main
        elif _commit_ok("origin/main"):
            excl = "origin/main"
        else:
            excl = None                                   # no trusted base -> scan ALL of tip (fail-safe, never nothing)
    # Never let the exclusion equal the tip (Codex re-review): merge-base(tip, origin/main)
    # resolves to tip when tip IS origin/main, and `tip..tip` scans ZERO. Scan all of tip.
    if excl:
        a = _run(["git", "rev-parse", "--verify", "-q", f"{excl}^{{commit}}"])
        b = _run(["git", "rev-parse", "--verify", "-q", f"{tip}^{{commit}}"])
        if a.returncode == 0 and b.returncode == 0 and a.stdout.strip() == b.stdout.strip():
            excl = None
    revargs = [f"{excl}..{tip}"] if excl else [tip]

    out = _git(["rev-list", "--objects"] + revargs)
    # (1) BLOB CONTENT. lines: "<sha> [path]" ; a blob line has a path, commits/trees don't.
    seen = {}
    for line in out.decode("utf-8", "replace").splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2 and parts[1]:
            seen.setdefault(parts[0], parts[1])
    hits = []
    for sha in seen:
        # blobs only (paths can also decorate tags). The authoritative range scan does NOT
        # skip by extension (Codex): a UTF-8 secret in a `.png`/`.docx` must not bypass —
        # binary/NUL content then fails closed inside _decode_text.
        t = _run(["git", "cat-file", "-t", sha])
        if t.returncode != 0:
            raise ScanError(f"cat-file -t {sha} failed")
        if t.stdout.decode("utf-8", "replace").strip() != "blob":
            continue
        hits += _scan_blob(sha, seen[sha])

    revs = _git(["rev-list"] + revargs).decode("utf-8", "replace").split()
    for h in revs:
        # (2) the full COMMIT OBJECT — message + author/committer (Codex re-review): read the
        # raw object per-SHA via cat-file so a delimiter byte in a message can't split records.
        c = _run(["git", "cat-file", "commit", h])
        if c.returncode != 0:
            raise ScanError(f"cat-file commit {h} failed")
        hits += scan_text(_decode_text(c.stdout, f"<commit:{h[:12]}>"), f"<commit:{h[:12]}>")
        # (3) changed FILENAMES incl. renames (Codex re-review): --no-renames splits a rename
        # into add+delete so a secret-bearing NEW name shows as an Add and is scanned, even
        # when the blob content is unchanged (no new blob in rev-list --objects).
        # --root: a root/orphan commit emits NO names without it. -m: a MERGE commit emits no
        # names without it (diff vs every parent). Codex pass-4: without both, a secret-bearing
        # FILENAME backed by a blob already reachable from BASE (so absent from rev-list
        # --objects BASE..HEAD) could be introduced via an orphan root + merge and never scanned.
        d = _git(["diff-tree", "-r", "-z", "--root", "-m", "--no-renames",
                  "--diff-filter=ACMT", "--name-only", "--no-commit-id", h])
        for p in d.split(b"\0"):
            if p:
                path = p.decode("utf-8", "replace")
                hits += scan_text(path, f"<path:{path}>")
    return hits


def main():
    args = sys.argv[1:]
    try:
        if "--staged" in args:
            hits = scan_staged()
        elif "--range" in args:
            i = args.index("--range")
            if i + 1 >= len(args):
                print("usage: secretscan.py --range BASE..TIP", file=sys.stderr)
                return 1
            hits = scan_range(args[i + 1])
        else:
            files = [a for a in args if not a.startswith("--")]
            if not files:
                print("usage: secretscan.py <file>... | --staged | --range BASE..TIP",
                      file=sys.stderr)
                return 1
            hits = scan_paths(files)
    except ScanError as e:
        print(f"SECRET SCAN INCOMPLETE (failing closed): {e}", file=sys.stderr)
        return 1

    if hits:
        print(f"SECRET SCAN FAILED — {len(hits)} potential secret(s):", file=sys.stderr)
        for path, ln, name, masked in hits:
            print(f"  {path}:{ln}  [{name}]  {masked}", file=sys.stderr)
        print("\nRefusing. Remove the secret or reference master.env. Annotatable "
              "false positives: append `# secretscan:allow <reason>`.", file=sys.stderr)
        return 2
    print("secret scan: clean", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
