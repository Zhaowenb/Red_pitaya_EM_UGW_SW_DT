"""Preflight new two-channel measurements against actual Red Pitaya limits."""
import copy
from .hardware_config import validate_hardware


def validate_measurement(base, measurement, *, big=False):
    validate_hardware(base)
    rp = base.redpitaya
    if rp['mode'] not in ('out1', 'out2'):
        raise ValueError('LCR 测量请选择单独 OUT1 或 OUT2；不能将轮流或同步联合响应当作一个阻抗测量')
    if rp.get('output2'):
        raise ValueError('LCR 使用测量页的激励参数；请清空 OUT2 独立覆盖参数')
    if set(base.enabled_channels) != {'A', 'B'} or {
        measurement.voltage_channel, measurement.current_channel
    } != {'A', 'B'}:
        raise ValueError('LCR 必须使用两个不同输入：IN1(A) 和 IN2(B)')
    if big and measurement.auto_monitor_range:
        raise ValueError('Red Pitaya 量程由 LV/HV 物理跳线决定，不支持软件自动量程')
    frequencies = measurement.frequencies_hz
    points = measurement.parameter_points if big else [(f, measurement.excitation_vpp) for f in frequencies]
    if len(points) * measurement.repeats > 10_000:
        raise ValueError('一次测量最多 10000 次采集')
    # Validate the longest record and largest output before creating any task.
    cfg = copy.deepcopy(base)
    cfg.awg.waveform = 'lcr_tone'
    cfg.awg.frequency_hz = min(frequencies)
    cfg.awg.cycles = measurement.burst_cycles
    cfg.awg.tone_ramp_cycles = measurement.ramp_cycles
    cfg.awg.pk_to_pk_v = max(v for _, v in points)
    cfg.awg.offset_v = 0
    pre_cycles = measurement.ramp_cycles + 3 if big else 2
    cfg.pre_trigger_samples = max(1, round(cfg.sample_rate_hz * max(pre_cycles / min(frequencies), 50e-6)))
    cfg.post_trigger_samples = max(2, round(cfg.sample_rate_hz * (measurement.burst_cycles + 5) / min(frequencies)))
    if cfg.sample_rate_hz / max(frequencies) < 8:
        raise ValueError('最高测量频率每周期至少需要 8 个采样点')
    validate_hardware(cfg)


THREE_CHANNEL_LIMIT = '此功能需要三路独立同步输入；Red Pitaya 仅有 IN1/IN2。支持导入 Pico 历史文件分析，不支持本板三通道采集。'
