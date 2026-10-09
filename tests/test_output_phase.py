import unittest
import numpy as np
from redscope.hardware_config import defaults
from redscope.waveforms import normalized_waveform
from redscope.device import RedPitaya


class OutputPhaseTests(unittest.TestCase):
    def test_preview_matches_dac_buffer(self):
        from redscope.web import awg_preview_payload
        from dataclasses import asdict
        cfg = defaults().awg
        preview = awg_preview_payload({**asdict(cfg), 'phase_deg': 90})
        expected, _ = normalized_waveform(cfg, 90)
        indices = np.arange(0, len(expected), preview['display_step'])
        np.testing.assert_allclose(preview['volts'], cfg.offset_v + expected[indices]*cfg.pk_to_pk_v/2)
        self.assertEqual(preview['phase_deg'], 90)

    def test_hann_carrier_not_envelope_shift(self):
        cfg = defaults().awg
        cfg.waveform = 'hann_burst'
        base, rate = normalized_waveform(cfg)
        inverse, other_rate = normalized_waveform(cfg, 180)
        quadrature, _ = normalized_waveform(cfg, 90)
        np.testing.assert_allclose(inverse, -base, atol=1e-12)
        self.assertEqual(rate, other_rate)
        self.assertEqual(quadrature[0], 0)
        self.assertEqual(quadrature[-1], 0)
        self.assertLess(abs(np.dot(base, quadrature)/np.linalg.norm(base)/np.linalg.norm(quadrature)), .001)

    def test_simultaneous_phase_cancellation(self):
        cfg = defaults()
        cfg.redpitaya['mode'] = 'simultaneous'
        device = RedPitaya(simulate=True)
        same = device.capture(cfg).volts['A']
        cfg.redpitaya['phase2_deg'] = 180
        opposite = device.capture(cfg).volts['A']
        self.assertLess(np.max(np.abs(opposite)), np.max(np.abs(same)) * .05)

    def test_phase_wrap(self):
        cfg = defaults().awg
        np.testing.assert_allclose(normalized_waveform(cfg, -90)[0], normalized_waveform(cfg, 270)[0])

    def test_cancel_relative_phase_preserved(self):
        cfg = defaults().awg
        for waveform in ('hann_cancel', 'hann_burst', 'lcr_tone', 'sine'):
            cfg.waveform = waveform
            np.testing.assert_allclose(normalized_waveform(cfg, 180)[0], -normalized_waveform(cfg)[0], atol=1e-12)
