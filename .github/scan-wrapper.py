# CHG-20261026-02: run the standard secretscan on every tracked file, with ONLY the public
# Supabase anon JWT (sha256 below, decoded role must be "anon") masked first. Any other JWT fails.
import base64, hashlib, json, os, re, subprocess, sys, tempfile
ANON_SHA256 = "d08b35620bdc76b3e1db45ff75043c0aea7632fe3e813e7f88bbb6d5a0d9b33d"
JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}")
def ok(t):
    if hashlib.sha256(t.encode()).hexdigest() != ANON_SHA256: return False
    p = t.split(".")[1]; p += "=" * (-len(p) % 4)
    return json.loads(base64.urlsafe_b64decode(p)).get("role") == "anon"
paths = [os.fsdecode(p) for p in subprocess.check_output(["git", "ls-files", "-z"]).split(b"\0") if p]
if not paths: sys.exit("No tracked files; refusing empty scan")
tmp = tempfile.mkdtemp(); files = []
for p in paths:
    try: s = open(p, encoding="utf-8").read()
    except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
        files.append(p); continue
    m = JWT.sub(lambda x: "SUPABASE_ANON_PUBLIC" if ok(x.group(0)) else x.group(0), s)
    if m != s:
        d = os.path.join(tmp, p); os.makedirs(os.path.dirname(d), exist_ok=True); open(d, "w").write(m); files.append(d)
    else: files.append(p)
sys.exit(subprocess.run(["python3", "-I", ".github/secretscan.py", *files]).returncode)
