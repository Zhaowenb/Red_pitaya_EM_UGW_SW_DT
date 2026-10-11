"""Legacy multi-channel waveform fixture, never used by the application."""
import math
import numpy as np
from redscope.config import AcquisitionConfig
from redscope.device import CaptureResult
from redscope.waveforms import normalized_waveform

class Pico4824A:
    def __init__(self, simulate=True):
        if not simulate: raise ValueError('Fixture is simulation-only')
        self.simulate=True
        self.is_open=False
    def open(self):self.is_open=True;return self
    def close(self):self.is_open=False
    def stop(self):pass
    def disable_awg_output(self):pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def capture(self, config: AcquisitionConfig) -> CaptureResult:
        sample_rate = config.sample_rate_hz
        interval = 1.0 / sample_rate
        time_s = (
            np.arange(config.total_samples, dtype=np.float64) - config.pre_trigger_samples
        ) * interval
        rng = np.random.default_rng(4824)
        volts: dict[str, np.ndarray] = {}
        frequency = config.awg.frequency_hz
        burst_duration = config.awg.cycles / frequency
        if config.awg.enabled:
            awg_values, awg_repetition_hz = normalized_waveform(config.awg)
            awg_duration = 1.0 / awg_repetition_hz
            awg_time = np.linspace(0.0, awg_duration, awg_values.size, endpoint=False)
        else:
            awg_values = np.zeros(2, dtype=np.float64)
            awg_time = np.array([0.0, interval], dtype=np.float64)
        for index, name in enumerate(config.enabled_channels):
            delay = index * 4e-6
            local_t = time_s - delay
            amplitude = config.awg.pk_to_pk_v / 2 * math.exp(-index / 3.5)
            direct = amplitude * np.interp(
                local_t,
                awg_time,
                awg_values,
                left=0.0,
                right=0.0,
            )
            echo_t = local_t - 60e-6
            echo_inside = (echo_t >= 0) & (echo_t <= burst_duration * 1.8)
            echo_envelope = np.zeros_like(time_s)
            echo_envelope[echo_inside] = np.sin(
                np.pi * echo_t[echo_inside] / (burst_duration * 1.8)
            ) ** 2
            echo = 0.22 * amplitude * np.sin(2 * np.pi * frequency * echo_t) * echo_envelope
            noise = rng.normal(0.0, max(amplitude * 0.006, 50e-6), time_s.size)
            volts[name] = np.asarray(direct + echo + noise, dtype=np.float64)
        return CaptureResult(
            time_s=time_s,
            volts=volts,
            sample_interval_s=interval,
            requested_sample_rate_hz=sample_rate,
            actual_sample_rate_hz=sample_rate,
            overflow_channels=(),
            config=config,
            simulated=True,
        )
