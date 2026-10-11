"""Read-only numerical comparison against a local Pico BTF checkout.

This script never calls either hardware adapter and never saves into the Pico
checkout. It compares identical synthetic input arrays, not clinical/defect labels.
"""
import argparse
import importlib
import json
from pathlib import Path
import sys
sys.dont_write_bytecode=True  # Reference imports must not create/update caches.
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,default=ROOT.parent/'Pico_4824A_btf');args=parser.parse_args()
sys.path[:0]=[str(ROOT/'app'),str(args.source.resolve())]

def module(package,name):return importlib.import_module(package+'.'+name)

def equal(a,b):
    if isinstance(a,dict):
        assert set(a)==set(b), (set(a)-set(b),set(b)-set(a))
        for key in a:equal(a[key],b[key])
    elif isinstance(a,(list,np.ndarray)):
        if len(a) and isinstance(a[0],dict):
            assert len(a)==len(b)
            for x,y in zip(a,b):equal(x,y)
        else:np.testing.assert_allclose(a,b,rtol=1e-8,atol=1e-10,equal_nan=True)
    elif isinstance(a,(float,int,np.number)) and not isinstance(a,bool):np.testing.assert_allclose(a,b,rtol=1e-8,atol=1e-10,equal_nan=True)
    else:assert a==b,(a,b)

fs=5e6;t=(np.arange(5000)-500)/fs
carrier=np.sin(2*np.pi*73700*t)
signal=carrier*np.exp(-((t-120e-6)/40e-6)**2)+.2*carrier*np.exp(-((t-480e-6)/60e-6)**2)
other=.8*np.roll(signal,12)+.001*np.cos(2*np.pi*180000*t)
checks=[]
for package in ['pico4824a','redscope']:
    module(package,'analysis')
for low,high in [(0,90e3),(60e3,90e3),(70e3,80e3)]:
    results=[module(p,'analysis').fft_bandpass(signal,fs,low,high,5000) for p in ['pico4824a','redscope']]
    equal(*results);checks.append(f'zero-phase bandpass {low:g}-{high:g}')
for method in ['stft','wpd','cwt']:
    raw={'method':method,'start_us':0,'end_us':600,'frequency_max_hz':250000,'frequency_bins':64,'max_time_bins':128}
    results=[module(p,'time_frequency').time_frequency_map(t,signal,raw) for p in ['pico4824a','redscope']]
    equal(*results);checks.append(method)
raw={'reference_channel':'A','comparison_channel':'B','start_us':0,'end_us':600,'frequency_hz':73700}
results=[module(p,'experimental_modes').experimental_mode_analysis(t,signal,other,raw) for p in ['pico4824a','redscope']]
equal(*results);checks.append('space-time symmetry TEST')
results=[]
for package in ['pico4824a','redscope']:
    config=module(package,'config').AcquisitionConfig(sample_rate_hz=fs,pre_trigger_samples=500,post_trigger_samples=4500)
    config.awg.frequency_hz=73700;config.awg.cycles=7
    capture=module(package,'device').CaptureResult(t,{'A':signal,'B':other},1/fs,fs,fs,(),config,True)
    sweep=module(package,'sweep').SweepConfig(receiver_channels=('A','B'),transmitter_channel='NONE')
    results.append(module(package,'sweep').capture_metrics(capture,sweep))
equal(*results);checks.append('N/f adaptive receiver metrics')
report={'reference':args.source.name,'input':'deterministic 5 MS/s, 73.7 kHz, 7 cycles, two arrays',
        'checks':checks,'status':'PASS','rtol':1e-8,'atol':1e-10,'hardware_accessed':False}
(ROOT/'docs/btf-algorithm-regression.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
