# CHG-20261026-02 "test" check: static-site sanity (no build step exists).
import re, sys, xml.etree.ElementTree as ET, glob
err = []
for f in glob.glob("sitemap*.xml"):
    try: ET.parse(f)
    except Exception as e: err.append(f"{f}: bad XML {e}")
if open("CNAME").read().strip() != "microschool.directory": err.append("CNAME changed")
t = open("llms.txt", encoding="utf-8").read()
if re.search(r"https?://\S*<[^>]+>", t): err.append("llms.txt has placeholder URL")
if not t.startswith("# "): err.append("llms.txt must start with '# '")
for f in ["index.html", "404.html", "robots.txt"]:
    try: open(f).close()
    except OSError: err.append(f"missing {f}")
print("\n".join(err) or "site-test OK"); sys.exit(1 if err else 0)
