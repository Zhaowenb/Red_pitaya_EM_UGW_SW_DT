"""Verify the read-only Pico reference has not changed since this import."""
import argparse
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=ROOT.parent/'Pico_4824A_btf');args=parser.parse_args()
manifest=json.loads((ROOT/'docs/btf-source-manifest.json').read_text(encoding='utf-8'))
changed=[name for name,expected in manifest.items() if not (args.source/name).is_file() or hashlib.sha256((args.source/name).read_bytes()).hexdigest()!=expected]
if changed:raise SystemExit('Changed reference files: '+', '.join(changed))
print(f'Pico BTF reference unchanged: {len(manifest)} files.')
