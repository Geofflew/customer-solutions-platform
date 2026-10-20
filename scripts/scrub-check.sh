#!/usr/bin/env bash
# Public-readiness scan. Private terms stay in an owner-maintained external denylist.
# Usage: DENYLIST=/path/to/private/denylist.txt scripts/scrub-check.sh [--history]
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gitleaks >/dev/null || { echo 'gitleaks is required'; exit 1; }
gitleaks detect --no-git --source . --redact
if [[ "${1:-}" == '--history' ]]; then gitleaks detect --source . --redact; fi
python3 - "${1:-}" <<'PY'
import os, re, subprocess, sys
from pathlib import Path
path = Path(os.environ.get('DENYLIST', '../private/denylist.txt'))
if not path.is_file():
    print('Private denylist unavailable; set DENYLIST to its local path.')
    sys.exit(1)
terms = [x.strip() for x in path.read_text().splitlines() if x.strip() and not x.lstrip().startswith('#')]
pattern = re.compile(r'(?<!\w)(?:' + '|'.join(map(re.escape, terms)) + r')(?!\w)', re.I)
files = subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard'], text=True).splitlines()
fail = False
for name in files:
    if name == 'pnpm-lock.yaml': continue # public dependency names; audit separately
    try: lines = Path(name).read_text().splitlines()
    except (UnicodeDecodeError, OSError): continue
    hits = [str(i) for i, line in enumerate(lines, 1) if pattern.search(line)]
    if hits:
        print(f'Private-term candidate: {name}, lines {", ".join(hits)} (content redacted)')
        fail = True
if sys.argv[1] == '--history':
    history = subprocess.check_output(['git', 'log', '-p', '--all', '--', '.', ':!pnpm-lock.yaml'], text=True)
    count = sum(bool(pattern.search(x)) for x in history.splitlines() if x.startswith('+') and not x.startswith('+++'))
    if count:
        print(f'History: {count} matching added lines (content redacted); inspect privately before release.')
        fail = True
print('Scrub requires review' if fail else f'Scrub clean ({len(terms)} private terms; values not printed)')
sys.exit(int(fail))
PY
