"""Explicit loopback acceptance: OUT1->IN1, OUT2->IN2, both LV.
Run on board from installed app with PYTHONPATH=. Only 0.1 Vpp, zero offset.
"""
import json
import time
from pathlib import Path
import numpy as np
from redscope.hardware_config import defaults, output_config
from redscope.device import RedPitaya
from redscope.storage import save_npz


def main():
    root = Path('/home/redpitaya/hann_scope_data') / ('phase_acceptance_' + time.strftime('%Y%m%d_%H%M%S'))
    root.mkdir(parents=True, exist_ok=False)
    rows = []
    device = RedPitaya(simulate=False)
    try:
        with device:
            for waveform in ('sine', 'hann_burst'):
                for phase in (0, 90, 180, -90):
                    cfg = defaults()
                    cfg.awg.waveform = waveform
                    cfg.awg.cycles = 30 if waveform == 'sine' else 7
                    cfg.awg.pk_to_pk_v = .1
                    cfg.awg.offset_v = 0
                    cfg.redpitaya.update(mode='simultaneous', phase1_deg=0, phase2_deg=phase,
                                         load='Hi-Z', roles={'A':'monitor','B':'monitor'}, output2={})
                    for number in (1, 2):
                        out = output_config(cfg, number)
                        assert 0 < out.pk_to_pk_v <= .5 and out.offset_v == 0
                    result = device.capture(cfg)
                    save_npz(result, root / f'{waveform}_{phase}.npz')
                    duration = cfg.awg.cycles / cfg.awg.frequency_hz
                    gate = (result.time_s > duration*.2) & (result.time_s < duration*.8)
                    t = result.time_s[gate]
                    basis = np.column_stack((np.sin(2*np.pi*cfg.awg.frequency_hz*t),
                                             np.cos(2*np.pi*cfg.awg.frequency_hz*t), np.ones(t.size)))
                    fitted = [np.linalg.lstsq(basis, result.volts[c][gate], rcond=None)[0] for c in 'AB']
                    angles = [np.degrees(np.arctan2(v[1], v[0])) for v in fitted]
                    measured = (angles[1]-angles[0]+180)%360-180
                    error = (measured-phase+180)%360-180
                    vpp = {c:float(np.ptp(result.volts[c])) for c in 'AB'}
                    row = dict(waveform=waveform, requested_phase_deg=phase, measured_phase_deg=float(measured),
                               phase_error_deg=float(error), measured_vpp=vpp, samples=result.samples,
                               actual_rate=result.actual_sample_rate_hz, overflow=list(result.overflow_channels),
                               passed=bool(abs(error)<5 and all(.07<v<.13 for v in vpp.values())
                                           and result.samples==50000 and not result.overflow_channels))
                    rows.append(row)
                    (root/'report.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
                    print(json.dumps(row), flush=True)
                    if not row['passed']:
                        raise RuntimeError('Acceptance failed; outputs stopped, inspect saved capture before continuing')
    finally:
        device.stop()
        print('OUTPUTS STOP REQUESTED; DATA=' + str(root), flush=True)


if __name__ == '__main__':
    main()
