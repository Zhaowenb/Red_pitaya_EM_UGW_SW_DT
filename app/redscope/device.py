"""Red Pitaya adapter; never imports PicoSDK. Wire data is little-endian float32."""
from dataclasses import dataclass
import copy
import os
import socket
import threading
import numpy as np
from .config import AcquisitionConfig
from .hardware_config import validate_hardware, output_config, BASE_RATE
from .waveforms import normalized_waveform, BURST_WAVEFORMS

@dataclass
class CaptureResult:
    time_s: np.ndarray
    volts: dict[str, np.ndarray]
    sample_interval_s: float
    requested_sample_rate_hz: float
    actual_sample_rate_hz: float
    overflow_channels: tuple[str, ...]
    config: AcquisitionConfig
    simulated: bool = False

    @property
    def samples(self):
        return int(self.time_s.size)

class RedPitaya:
    def __init__(self, simulate=False, serial=None):
        self.simulate = simulate
        self.is_open = False
        self.last_captures = []
        self.cancel = threading.Event()

    def __enter__(self):
        self.is_open = True
        self.cancel.clear()
        return self

    def open(self):
        return self.__enter__()

    def close(self):
        self.__exit__()

    def __exit__(self, *args):
        self.is_open = False
        self.stop()

    def stop(self):
        self.cancel.set()
        if self.simulate:
            return
        try:
            with self._socket(1) as connection:
                connection.sendall(b'STOP\n')
        except (OSError, RuntimeError):
            pass

    def _socket(self, timeout):
        if not hasattr(socket, 'AF_UNIX'):
            raise RuntimeError('本机不支持板端 Unix socket；请启用仿真，实机服务须在 Red Pitaya 上运行')
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.settimeout(timeout)
        try:
            connection.connect(os.environ.get('HANNSCOPE_SOCKET', '/run/hann_scope/hardware.sock'))
        except Exception:
            connection.close()
            raise RuntimeError('无法连接 Red Pitaya 硬件服务；请检查 hann-scope-hardware 服务')
        return connection

    def capture(self, config):
        decimation = validate_hardware(config)
        modes = ['out1','out2'] if config.redpitaya['mode'] == 'alternating' else [config.redpitaya['mode']]
        self.last_captures = []
        for mode in modes:
            if self.cancel.is_set():
                raise RuntimeError('采集已停止')
            current = copy.deepcopy(config)
            current.redpitaya['requested_mode'] = config.redpitaya['mode']
            current.redpitaya['mode'] = mode
            current.redpitaya['excitation_id'] = {'out1':'OUT1','out2':'OUT2','simultaneous':'OUT1+OUT2'}[mode]
            result = self._simulate(current) if self.simulate else self._capture(current, decimation)
            self.last_captures.append(result)
        return self.last_captures[0]

    def _capture(self, config, decimation):
        rp = config.redpitaya
        mask = {'out1':1,'out2':2,'simultaneous':3}[rp['mode']] if config.awg.enabled else 0
        if mask == 0 and rp['trigger_source'] == 'internal' and config.trigger.enabled:
            raise ValueError('内部 AWG 触发需要启用输出；无输出采集请选择模拟或外部触发')
        source = {'internal':1,'analog':2 if config.trigger.source=='A' else 3,'external':4}[rp['trigger_source']]
        if not config.trigger.enabled:
            source = 0
        header = [decimation, config.total_samples, config.pre_trigger_samples, mask, source,
                  int(config.trigger.direction=='falling'), config.trigger.threshold_v,
                  config.capture_timeout_s, int(config.channels['A'].range=='20V'), int(config.channels['B'].range=='20V')]
        waves = []
        for number in (1,2):
            output = output_config(config, number)
            values, frequency = normalized_waveform(output, float(rp.get(f'phase{number}_deg', 0)))
            # Hardware service explicitly uses Hi-Z API reference. A 50-ohm
            # termination halves the open-circuit voltage at the connector.
            scale = 1.0 if rp['load']=='Hi-Z' else 2.0
            cycles = 1 if output.waveform in BURST_WAVEFORMS or output.waveform=='custom' else output.cycles
            header.extend([values.size, frequency, output.pk_to_pk_v/2*scale,
                           output.offset_v*scale, 0.0, cycles])
            waves.append(np.asarray(values,dtype='<f4').tobytes())
        with self._socket(config.capture_timeout_s + 5) as connection:
            connection.sendall(('CAPTURE '+' '.join(map(str,header))+'\n').encode()+b''.join(waves))
            stream = connection.makefile('rb')
            response = stream.readline(4096).decode().strip()
            if not response.startswith('OK '):
                raise RuntimeError(response or '硬件服务中断')
            _, count, rate = response.split()
            count, rate = int(count), float(rate)
            if count != config.total_samples or rate != BASE_RATE/decimation:
                raise RuntimeError('硬件采样配置与请求不一致')
            raw = stream.read(count*2*4)
            if len(raw)!=count*2*4:
                raise RuntimeError('采集数据不完整')
        matrix = np.frombuffer(raw,dtype='<f4').reshape(2,count)
        volts = {name:matrix[index].astype(np.float64) for index,name in enumerate('AB') if config.channels[name].enabled}
        overflow = tuple(name for name,values in volts.items() if np.any(np.abs(values)>=float(config.channels[name].range[:-1])*.99))
        return CaptureResult((np.arange(count)-config.pre_trigger_samples)/rate,volts,1/rate,config.sample_rate_hz,rate,overflow,config)

    def _simulate(self, config):
        if config.redpitaya['mode'] == 'simultaneous':
            separate = []
            for mode in ('out1', 'out2'):
                current = copy.deepcopy(config)
                current.redpitaya['mode'] = mode
                separate.append(self._simulate(current))
            result = separate[0]
            result.config = config
            result.volts = {name: result.volts[name] + separate[1].volts[name] for name in result.volts}
            return result
        t = (np.arange(config.total_samples)-config.pre_trigger_samples)/config.sample_rate_hz
        output = 2 if config.redpitaya['mode']=='out2' else 1
        awg = output_config(config,output)
        values,repetition = normalized_waveform(awg, float(config.redpitaya.get(f'phase{output}_deg', 0)))
        waveform_t = np.arange(values.size)/values.size/repetition
        rng = np.random.default_rng(12514+output)
        volts = {}
        for index,name in enumerate(config.enabled_channels):
            if awg.waveform == 'lcr_tone':
                # Deterministic two-monitor fixture for local workflow testing.
                # Both channels see the flat-top tone, with a known phase offset.
                phase_delay = index * 0.35 / (2 * np.pi * awg.frequency_hz)
                v = np.interp(t-phase_delay,waveform_t,values,left=0,right=0)*awg.pk_to_pk_v/2*(1 if index == 0 else .6)
            elif config.redpitaya['roles'][name]=='monitor':
                v = np.interp(t,waveform_t,values,left=0,right=0)*awg.pk_to_pk_v/2 + awg.offset_v
            else:
                v = np.zeros_like(t)
                for delay,gain in ((80e-6,.18),(300e-6,.018),(800e-6,.12)):
                    v += np.interp(t-delay-index*2e-6,waveform_t,values,left=0,right=0)*gain*awg.pk_to_pk_v/2
            volts[name] = (v if awg.enabled else np.zeros_like(t)) + rng.normal(0, .00004, t.size)
        return CaptureResult(t,volts,1/config.sample_rate_hz,config.sample_rate_hz,config.sample_rate_hz,(),config,True)

# Compatibility name for the reused orchestration and analysis modules.
Pico4824A = RedPitaya
