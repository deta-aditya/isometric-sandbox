"""Work out the publish_files arguments for the artifact from what changed in dist/.

  python3 tools/publish_plan.py            print files to send and files to remove (JSON)
  python3 tools/publish_plan.py --record V after a successful publish: remember dist/ as version V

The manifest (tools/published.json) holds the artifact slug, the last published version and a
sha256 per served path, so a publish only sends what changed and removes what the build dropped.
"""
import hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
MANIFEST = os.path.join(ROOT, 'tools', 'published.json')

def current():
    out = {}
    for base, _, files in os.walk(DIST):
        for f in files:
            full = os.path.join(base, f)
            out[os.path.relpath(full, DIST)] = hashlib.sha256(open(full, 'rb').read()).hexdigest()
    return out

manifest = json.load(open(MANIFEST))
now = current()
if len(sys.argv) == 3 and sys.argv[1] == '--record':
    manifest.update(version=sys.argv[2], files=now)
    json.dump(manifest, open(MANIFEST, 'w'), indent=1, sort_keys=True)
    print(f"recorded {len(now)} files as version {sys.argv[2]}")
else:
    old = manifest['files']
    send = [{'as': p, 'path': os.path.join(DIST, p)} for p in sorted(now) if old.get(p) != now[p]]
    remove = sorted(p for p in old if p not in now)
    print(json.dumps({'slug': manifest['slug'], 'base_version': manifest['version'], 'files': send, 'remove': remove}, indent=1))
