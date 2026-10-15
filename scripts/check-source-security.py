#!/usr/bin/env python3
"""Reject credential material and persistent state in source or compiled artifacts."""
from pathlib import Path
import json,re,subprocess,sys
root=Path(__file__).resolve().parent.parent
paths=[root/p for p in subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()]
if (root/'dist').exists():paths.extend(p for p in (root/'dist').rglob('*') if p.is_file())
failures=[]
private_header=b'-----BEGIN '+b'PRIVATE KEY-----'
for path in paths:
    if not path.is_file() or path.stat().st_size>10_000_000:continue
    data=path.read_bytes()
    reason=None
    if private_header in data or re.search(rb'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}',data):reason='credential marker'
    try:
        parsed=json.loads(data)
        if isinstance(parsed,dict) and (parsed.get('type')=='service_account' or parsed.get('private_key')):reason='service-account credential'
    except (ValueError,UnicodeDecodeError):pass
    if path.suffix in ('.sqlite','.db') or data.startswith(b'SQLite format 3'):reason='persistent database'
    if reason:failures.append((str(path.relative_to(root)),reason))
if failures:
    for path,reason in failures:print(f'REJECT {path}: {reason}',file=sys.stderr)
    sys.exit(1)
print(f'PASS: {len(paths)} source/artifact files scanned; no credentials or database artifacts.')
