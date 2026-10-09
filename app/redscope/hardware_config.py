"""Real hardware limits, kept separate from legacy Pico file validation."""
import math
from .config import AcquisitionConfig, AwgConfig, CHANNEL_NAMES

BASE_RATE = 125_000_000
MAX_SAMPLES = 2_000_000

def defaults():
    return AcquisitionConfig.from_dict({
        'sample_rate_hz': 5_000_000, 'pre_trigger_samples': 5000, 'post_trigger_samples': 45000,
        'channels': {n: {'enabled': n in 'AB', 'range': '1V'} for n in CHANNEL_NAMES},
        'trigger': {'source': 'A', 'threshold_v': .02},
        'awg': {'frequency_hz': 73700, 'cycles': 7, 'pk_to_pk_v': .1, 'buffer_samples': 16384},
        'redpitaya': {'mode': 'alternating', 'trigger_source': 'internal', 'roles': {'A': 'receiver', 'B': 'receiver'},
                      'load': 'Hi-Z', 'output2': {}, 'phase1_deg': 0, 'phase2_deg': 0},
    })

def validate_hardware(config):
    config.validate()
    if not config.redpitaya:
        raise ValueError('Missing Red Pitaya configuration; legacy files are analysis-only')
    rp = config.redpitaya
    if not math.isfinite(config.capture_timeout_s) or not 0 < config.capture_timeout_s <= 120:
        raise ValueError('硬件任务超时必须在 0–120 秒内')
    if set(config.enabled_channels) - {'A', 'B'}:
        raise ValueError('本板仅有 IN1(A)、IN2(B) 两路 ADC')
    if not 32 <= config.total_samples <= MAX_SAMPLES:
        raise ValueError(f'单次必须为 32–{MAX_SAMPLES:,} 点/通道，请调整采样率或时长')
    rate = config.sample_rate_hz
    if not math.isfinite(rate) or rate <= 0:
        raise ValueError('Invalid sample rate')
    dec = round(BASE_RATE / rate)
    if dec not in (1, 2, 4, 8) and not 16 <= dec <= 65536:
        raise ValueError('抽取系数必须为 1、2、4、8 或 16–65536')
    actual = BASE_RATE / dec
    if not math.isclose(actual, rate, rel_tol=1e-6):
        raise ValueError(f'请求采样率不支持；最近合法值为 {actual:g} S/s（抽取 {dec}）')
    if rp.get('mode') not in ('out1', 'out2', 'alternating', 'simultaneous'):
        raise ValueError('Invalid excitation mode')
    if rp.get('trigger_source') not in ('internal', 'analog', 'external'):
        raise ValueError('Invalid trigger source')
    if config.trigger.direction not in ('rising', 'falling'):
        raise ValueError('当前触发只支持上升沿或下降沿')
    if config.trigger.delay_samples:
        raise ValueError('请使用预触发比例配置位置，额外触发延迟尚不支持')
    roles = rp.get('roles', {})
    if set(roles) != {'A', 'B'} or any(r not in ('receiver','monitor','disabled') for r in roles.values()):
        raise ValueError('IN1/IN2 必须设置接收、监测或禁用角色')
    for name in 'AB':
        ch = config.channels[name]
        if ch.enabled != (roles[name] != 'disabled'):
            raise ValueError(f'{name} 通道启用与角色不一致')
        if ch.range not in ('1V', '20V') or ch.coupling != 'DC' or ch.analog_offset_v:
            raise ValueError('输入采用物理 LV/HV 跳线与 DC 耦合；不支持模拟偏置')
    if rp.get('load') not in ('Hi-Z', '50ohm'):
        raise ValueError('必须明确输出负载参考')
    for number in (1,2):
        output = output_config(config, number)
        output.validate()
        if output.buffer_samples != 16384:
            raise ValueError('Red Pitaya 任意波形必须使用 16384 点，以保证实际输出频率正确')
        if not all(math.isfinite(v) for v in (output.pk_to_pk_v,output.offset_v,output.frequency_hz,float(rp.get(f'phase{number}_deg',0)))):
            raise ValueError('输出参数必须为有限数值')
        limit = 1.8 if rp['load'] == 'Hi-Z' else .9
        if abs(output.offset_v) + output.pk_to_pk_v / 2 > limit:
            raise ValueError(f'负载参考 {rp["load"]} 下 |偏置|+Vpp/2 不能超过 {limit} V')
    return dec

def output_config(config, number):
    raw = dict(vars_from_slots(config.awg))
    if number == 2:
        raw.update((config.redpitaya or {}).get('output2', {}))
    return AwgConfig(**raw)

def vars_from_slots(value):
    from dataclasses import asdict
    return asdict(value)

def capabilities():
    return {'model': 'STEMlab 125-14 Pro Z7020 Gen2', 'inputs': {'A':'IN1','B':'IN2'},
            'outputs': ['OUT1','OUT2'], 'adc_base_rate_hz': BASE_RATE,
            'max_samples_per_channel': MAX_SAMPLES, 'ranges': ['1V','20V'],
            'range_switch': 'physical-jumper', 'coupling': ['DC'],
            'modes': ['out1','out2','alternating','simultaneous'], 'backend': 'unix-socket',
            'deep_memory': 'probe-on-board', 'configuration': defaults().to_dict()}
