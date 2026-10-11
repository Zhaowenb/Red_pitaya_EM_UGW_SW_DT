"""Portable regression runner: isolated data, no board sockets/USB/DAC."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'app'),str(ROOT/'tests')]
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
from redscope import web, server

def main():
    (ROOT/'.test-tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ROOT/'.test-tmp') as folder:
        data=Path(folder).resolve()
        (data/'.test-tmp').mkdir()
        with patch.object(web,'DATA_DIR',data),patch.object(server,'ROOT',data),patch.object(tempfile,'tempdir',str(data)),patch.object(web.PicoWebHandler,'log_message',lambda *args:None):
            loader=unittest.TestLoader()
            suite=loader.discover(str(ROOT/'tests'),pattern='test_*.py')
            if '--base-only' not in sys.argv:
                suite.addTests(loader.discover(str(ROOT/'tests'),pattern='btf_test_*.py'))
            result=unittest.TextTestRunner(verbosity=2 if '-v' in sys.argv else 1).run(suite)
            return 0 if result.wasSuccessful() else 1

if __name__=='__main__':sys.exit(main())
