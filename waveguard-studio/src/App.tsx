import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { AnimatePresence, motion } from 'motion/react';
import { toPng } from 'html-to-image';
import {
  Activity, ArrowRight, Check, ChevronLeft, ChevronRight, CirclePause, Cpu,
  Database, Download, FlaskConical, Gauge, HeartPulse, Menu, Play, Radio,
  RotateCcw, ScanLine, SlidersHorizontal, Sparkles, Thermometer, Wifi, X, Zap,
} from 'lucide-react';
import {
  baselineReceivers, candidatePositionM, candidateTime, capturePair, correlation,
  directTime, endTime, receiverComponents, timeUs, traces, waveformData, windows,
  type SignalId,
} from './signal-model';

type PageId = 'overview' | 'experiment' | 'analysis' | 'sweep' | 'health';
type AnalysisView = 'echo' | 'components' | 'timefreq';

const pages: Array<{ id: PageId; cn: string; en: string }> = [
  { id: 'overview', cn: '总览', en: 'OVERVIEW' },
  { id: 'experiment', cn: '导波实验', en: 'CAPTURE' },
  { id: 'analysis', cn: '单次分析', en: 'ANALYSIS' },
  { id: 'sweep', cn: '参数研究', en: 'SWEEP' },
  { id: 'health', cn: '健康档案', en: 'HEALTH' },
];

const demoSteps: Array<{ title: string; copy: string; page: PageId }> = [
  { title: '确认同端阵列', copy: '两组激励与两组接收均安装在拉线棒同一端。', page: 'overview' },
  { title: '发出 Hann 波包', copy: '73.7 kHz、7 周期，输出监测与采集共用时间基准。', page: 'experiment' },
  { title: '核验激励质量', copy: '先检查 TX 幅值、相位与饱和，再解释接收信号。', page: 'analysis' },
  { title: '识别三类到达', copy: '区分首波、候选反射和 2 m 端面反射。', page: 'analysis' },
  { title: '估计反射位置', copy: '利用同端脉冲回波比例法得到约 0.58 m。', page: 'analysis' },
  { title: '优选工作点', copy: '综合回波 SNR、拖尾与双接收一致性。', page: 'sweep' },
  { title: '形成复测决策', copy: '当前为算法演示结论，等待真实标定闭环。', page: 'health' },
];

function Chart({ option, className = '', onClick }: { option: EChartsOption; className?: string; onClick?: (params: any) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const handler = useRef(onClick);
  handler.current = onClick;
  useEffect(() => {
    if (!root.current) return;
    const chart = echarts.init(root.current, undefined, { renderer: 'canvas' });
    chart.setOption(option, true);
    chart.on('click', (params) => handler.current?.(params));
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(root.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, []);
  useEffect(() => { if (root.current) echarts.getInstanceByDom(root.current)?.setOption(option, true); }, [option]);
  return <div className={`chart ${className}`} ref={root} />;
}

function SignalField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frame = 0;
    let raf = 0;
    const resize = () => { canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = canvas.clientHeight * devicePixelRatio; };
    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      const base = height * .55;
      for (let line = 0; line < 9; line += 1) {
        context.beginPath();
        const phase = frame * .015 - line * .42;
        for (let x = 0; x <= width; x += 7) {
          const n = x / width;
          const packet = Math.exp(-Math.pow((n - ((frame * .00065 + line * .075) % 1.25)) / .085, 2));
          const echo = .42 * Math.exp(-Math.pow((n - .72 + ((frame * .00032) % .15)) / .055, 2));
          const y = base + (line - 4) * 19 * devicePixelRatio + Math.sin(n * 110 + phase) * (packet + echo) * 46 * devicePixelRatio;
          x === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
        }
        const alpha = .11 + (line === 4 ? .55 : 0);
        context.strokeStyle = line === 4 ? `rgba(255,90,54,${alpha})` : `rgba(128,152,158,${alpha})`;
        context.lineWidth = line === 4 ? 1.6 * devicePixelRatio : .7 * devicePixelRatio;
        context.stroke();
      }
      frame += 1;
      raf = requestAnimationFrame(draw);
    };
    resize(); draw();
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas className="signal-field" ref={canvasRef} />;
}

function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <motion.div className="landing" exit={{ opacity: 0, scale: 1.015 }} transition={{ duration: .55 }}>
      <SignalField />
      <header className="landing-header"><Brand /><div className="landing-live"><i /> RED PITAYA ONLINE</div></header>
      <div className="landing-rail left"><span>STEMLAB 125–14 PRO</span><span>Z7020 GEN2</span></div>
      <main className="landing-copy">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .25 }}>PULSE–ECHO GUIDED WAVE INSTRUMENT</motion.p>
        <motion.h1 initial={{ y: 38, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .12, duration: .75 }}>
          MEASURE<br /><em>THE RETURN.</em>
        </motion.h1>
        <motion.div className="landing-action" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: .48 }}>
          <p>让回波说清结构状态。<br /><span>2 m 拉线棒 · 同端双激励 / 双接收</span></p>
          <button onClick={onEnter}>进入工作台 <ArrowRight size={18} /></button>
        </motion.div>
      </main>
      <div className="landing-bottom"><span>73.700 kHz</span><span>7 CYCLES</span><span>5.000 MS/s</span><span>10.000 ms RECORD</span><b>DEMO DATA</b></div>
    </motion.div>
  );
}

function Brand() {
  return <div className="brand"><span className="brand-glyph"><i /><i /><i /></span><strong>WaveGuard</strong><small>STUDIO</small></div>;
}

function PageHead({ index, title, eyebrow, copy, action }: { index: string; title: string; eyebrow: string; copy: string; action?: ReactNode }) {
  return <header className="page-head"><span className="page-index">{index}</span><div><small>{eyebrow}</small><h1>{title}</h1><p>{copy}</p></div>{action && <div className="page-action">{action}</div>}</header>;
}

function SameEndRod({ active = true }: { active?: boolean }) {
  const position = 145 + candidatePositionM / 2 * 875;
  return (
    <div className={`rod-scene ${active ? 'active' : ''}`}>
      <div className="rod-meta"><span>传感端 / 0.00 m</span><span>自由端 / 2.00 m</span></div>
      <svg viewBox="0 0 1200 300" aria-label="同端双激励双接收脉冲回波示意">
        <defs><linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#596064"/><stop offset=".45" stopColor="#b8bec0"/><stop offset=".55" stopColor="#4f5558"/><stop offset="1" stopColor="#25292b"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="8" /></filter></defs>
        <rect x="145" y="143" width="875" height="22" rx="11" fill="url(#metal)" />
        <line x1="1020" y1="119" x2="1020" y2="190" stroke="#8a9294" />
        <text x="1020" y="108" textAnchor="middle">FREE END</text>
        {[
          ['TX-A', 160, '#ff5a36'], ['TX-B', 184, '#f2b84b'], ['RX-A', 208, '#52d6ff'], ['RX-B', 232, '#71e6a4'],
        ].map(([label, x, color]) => <g key={String(label)}><rect x={Number(x)} y="125" width="14" height="58" rx="4" fill={String(color)} /><text x={Number(x) + 7} y="210" fill={String(color)} textAnchor="middle">{label}</text></g>)}
        <g className="outbound"><path d="M240 148 C330 91 390 210 480 148 S630 91 720 148 S870 210 990 148" fill="none" stroke="#ff5a36" strokeWidth="2"/><circle cx="0" cy="0" r="25" fill="#ff5a36" opacity=".18" filter="url(#glow)"/></g>
        <g className="return"><path d="M990 160 C890 113 820 204 720 160 S560 113 460 160 S310 204 240 160" fill="none" stroke="#52d6ff" strokeWidth="2" strokeDasharray="7 8"/></g>
        <line x1={position} y1="95" x2={position} y2="205" stroke="#f2b84b" strokeDasharray="4 6" />
        <circle cx={position} cy="154" r="27" fill="none" stroke="#f2b84b" opacity=".7" />
        <text x={position} y="75" textAnchor="middle" fill="#f2b84b">CANDIDATE · {candidatePositionM.toFixed(2)} m</text>
      </svg>
      <div className="rod-legend"><span><i className="tx" />发射波包 →</span><span><i className="rx" />← 反射回波</span><span>同端脉冲回波几何</span></div>
    </div>
  );
}

function Overview({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return <div className="page overview">
    <PageHead index="01" eyebrow="SYSTEM GEOMETRY" title="一根棒，一端阵列，一条证据链。" copy="这里不堆指标。先把测量对象、传播方向与反射位置讲清楚。" action={<button className="outline-button" onClick={() => onNavigate('experiment')}>配置实验 <ArrowRight size={16}/></button>} />
    <section className="hero-instrument"><div className="instrument-top"><span><i /> ARRAY READY</span><b>2.000 m / PULSE–ECHO</b></div><SameEndRod /></section>
    <section className="timing-strip">
      <div><small>FIRST ARRIVAL</small><strong>{directTime.toFixed(1)} <em>μs</em></strong><span>接收首波</span></div>
      <div><small>CANDIDATE ECHO</small><strong>{candidateTime.toFixed(1)} <em>μs</em></strong><span>两路共同出现</span></div>
      <div><small>END ECHO</small><strong>{endTime.toFixed(1)} <em>μs</em></strong><span>2 m 自由端参照</span></div>
      <div className="accent"><small>ESTIMATED POSITION</small><strong>{candidatePositionM.toFixed(2)} <em>m</em></strong><span>距传感端 · 比例定位</span></div>
    </section>
    <div className="overview-note"><span>METHOD 01</span><p>x = L × (t<sub>echo</sub> − t<sub>first</sub>) / (t<sub>end</sub> − t<sub>first</sub>)</p><p>位置来自同端脉冲回波的相对飞行时间；波速误差在比例中部分抵消。</p></div>
  </div>;
}

function laneOption(progress = 1, markWindows = false): EChartsOption {
  const count = Math.max(8, Math.floor(timeUs.length * progress));
  const grids = traces.map((_, index) => ({ left: 74, right: 22, top: 16 + index * 23.5 + '%', height: '17%' }));
  return {
    animationDuration: 250,
    backgroundColor: 'transparent',
    grid: grids,
    tooltip: { trigger: 'axis', backgroundColor: '#171a1b', borderColor: '#353a3c', textStyle: { color: '#e9ebea', fontFamily: 'monospace' } },
    xAxis: traces.map((_, index) => ({ type: 'value', gridIndex: index, min: -160, max: 1100, axisLine: { show: index === 3, lineStyle: { color: '#454a4c' } }, axisTick: { show: false }, axisLabel: { show: index === 3, color: '#72797b' }, splitLine: { show: true, lineStyle: { color: '#1d2122' } } })),
    yAxis: traces.map((trace, index) => ({ type: 'value', gridIndex: index, min: -1.1, max: 1.1, interval: 1, name: trace.id, nameLocation: 'middle', nameGap: 42, nameTextStyle: { color: trace.color, fontWeight: 700, fontFamily: 'monospace' }, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#242829' } } })),
    series: traces.map((trace, index) => ({
      type: 'line', xAxisIndex: index, yAxisIndex: index, data: timeUs.slice(0, count).map((time, point) => [time, trace.values[point]]), showSymbol: false, sampling: 'lttb', lineStyle: { color: trace.color, width: index < 2 ? 1.35 : 1.6 },
      markArea: markWindows && index >= 2 ? { silent: true, label: { color: '#8d9597', fontSize: 9 }, data: [[{ name: '首波', xAxis: 70, itemStyle: { color: 'rgba(82,214,255,.05)' } }, { xAxis: 150 }], [{ name: '候选反射', xAxis: 240, itemStyle: { color: 'rgba(242,184,75,.07)' } }, { xAxis: 360 }], [{ name: '端面反射', xAxis: 740, itemStyle: { color: 'rgba(113,230,164,.045)' } }, { xAxis: 870 }]] } : undefined,
    })),
  } as EChartsOption;
}

function Range({ label, value, unit, min, max, step, onChange }: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="range"><span>{label}<output>{value} <small>{unit}</small></output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>;
}

function Experiment() {
  const [frequency, setFrequency] = useState(73.7);
  const [cycles, setCycles] = useState(7);
  const [amplitude, setAmplitude] = useState(.2);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(1);
  const [selected, setSelected] = useState<SignalId>('RX-A');
  useEffect(() => {
    if (!running) return;
    setProgress(.015);
    const start = performance.now();
    const timer = window.setInterval(() => { const next = Math.min(1, (performance.now() - start) / 2600); setProgress(next); if (next >= 1) { setRunning(false); window.clearInterval(timer); } }, 35);
    return () => window.clearInterval(timer);
  }, [running]);
  const option = useMemo(() => laneOption(progress), [progress]);
  const activeTrace = traces.find((trace) => trace.id === selected)!;
  return <div className="page experiment">
    <PageHead index="02" eyebrow="SYNCHRONOUS CAPTURE" title="激励与接收，分轨观察。" copy="四条曲线不是四条传播路径：上两轨核验输出，下两轨解释结构响应。" action={<span className={`capture-state ${running ? 'running' : ''}`}><i />{running ? 'CAPTURING' : 'ARMED'}</span>} />
    <div className="workspace-grid">
      <section className="plot-panel"><div className="panel-bar"><span>4–LANE OSCILLOSCOPE</span><b>DISPLAY −0.16—1.10 ms</b></div><Chart option={option} className="lane-chart"/><div className="record-bar"><span>10 ms RECORD</span><i><b style={{ width: `${progress * 100}%` }}/></i><span>5 MS/s · COMMON CLOCK</span></div></section>
      <aside className="control-rail"><div className="rail-title"><SlidersHorizontal size={17}/><span>HANN BURST</span></div><Range label="中心频率" value={frequency} unit="kHz" min={40} max={120} step={.1} onChange={setFrequency}/><Range label="周期数" value={cycles} unit="cycles" min={3} max={15} step={1} onChange={setCycles}/><Range label="输出幅值" value={amplitude} unit="Vpp" min={.05} max={1} step={.05} onChange={setAmplitude}/><dl><div><dt>采样率</dt><dd>5 MS/s</dd></div><div><dt>记录长度</dt><dd>10 ms</dd></div><div><dt>触发源</dt><dd>TX-A MON</dd></div></dl><button className="run" onClick={() => setRunning((value) => !value)}>{running ? <><CirclePause size={18}/>停止</> : <><Play size={18} fill="currentColor"/>运行实验</>}</button></aside>
    </div>
    <section className="signal-roles">{traces.map((trace) => <button key={trace.id} className={selected === trace.id ? 'active' : ''} onClick={() => setSelected(trace.id)} style={{ '--signal': trace.color } as CSSProperties}><i/><small>{trace.source === 'DEMO' ? 'DEMO DERIVED' : `PICO ${trace.source}`}</small><strong>{trace.id}</strong><span>{trace.role}</span></button>)}<div className="role-detail"><small>SELECTED CHANNEL</small><strong style={{ color: activeTrace.color }}>{activeTrace.id}</strong><p>{activeTrace.id.startsWith('TX') ? '判断激励是否正确，不参与缺陷位置计算。' : '独立提取到达时刻，再用双通道一致性确认回波。'}</p></div></section>
  </div>;
}

function componentOption(): EChartsOption {
  return {
    animationDuration: 500, grid: [{ left: 70, right: 20, top: 28, height: '35%' }, { left: 70, right: 20, top: '57%', height: '35%' }],
    tooltip: { trigger: 'axis', backgroundColor: '#171a1b', borderColor: '#353a3c', textStyle: { color: '#eee' } },
    xAxis: [0, 1].map((index) => ({ type: 'value', gridIndex: index, min: -160, max: 1100, axisLabel: { show: index === 1, color: '#6f7779' }, splitLine: { lineStyle: { color: '#202425' } } })),
    yAxis: [{ type: 'value', gridIndex: 0, name: '同相分量', nameTextStyle: { color: '#52d6ff' }, axisLabel: { show: false }, splitLine: { lineStyle: { color: '#202425' } } }, { type: 'value', gridIndex: 1, name: '差分分量', nameTextStyle: { color: '#f2b84b' }, axisLabel: { show: false }, splitLine: { lineStyle: { color: '#202425' } } }],
    series: [{ type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: waveformData(receiverComponents.common), showSymbol: false, lineStyle: { color: '#52d6ff', width: 1.6 } }, { type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: waveformData(receiverComponents.difference), showSymbol: false, lineStyle: { color: '#f2b84b', width: 1.6 } }],
  };
}

function timeFrequencyOption(): EChartsOption {
  const data: number[][] = [];
  for (let x = 0; x < 58; x += 1) for (let y = 0; y < 32; y += 1) {
    const direct = 35 * Math.exp(-Math.pow((x - 14) / 4, 2) - Math.pow((y - 14) / 5, 2));
    const candidate = 24 * Math.exp(-Math.pow((x - 27) / 4.5, 2) - Math.pow((y - 14) / 6, 2));
    const end = 19 * Math.exp(-Math.pow((x - 46) / 5, 2) - Math.pow((y - 14) / 7, 2));
    data.push([x, y, -62 + direct + candidate + end + Math.sin(x * .8 + y) * 2]);
  }
  return { animationDuration: 700, grid: { left: 54, right: 50, top: 20, bottom: 42 }, xAxis: { type: 'category', data: Array.from({ length: 58 }, (_, index) => Math.round(index * 19)), axisLabel: { color: '#687072', interval: 8 }, name: '时间 / μs' }, yAxis: { type: 'category', data: Array.from({ length: 32 }, (_, index) => Math.round(20 + index * 4)), axisLabel: { color: '#687072', interval: 5 }, name: '频率 / kHz' }, visualMap: { min: -62, max: -20, right: 0, top: 'middle', itemHeight: 160, textStyle: { color: '#777f81' }, inRange: { color: ['#0c1011', '#172a32', '#1a6572', '#e15335', '#ffc36a'] } }, series: [{ type: 'heatmap', data, progressive: 3000 }] };
}

function Analysis() {
  const [view, setView] = useState<AnalysisView>('echo');
  const option = useMemo(() => view === 'echo' ? laneOption(1, true) : view === 'components' ? componentOption() : timeFrequencyOption(), [view]);
  const corrA = correlation(traces[2].values, baselineReceivers.a) * 100;
  const corrB = correlation(traces[3].values, baselineReceivers.b) * 100;
  return <div className="page analysis">
    <PageHead index="03" eyebrow="EVIDENCE, NOT DECORATION" title="每条波形，各司其职。" copy="先证明激励可信，再从两路接收中寻找重复出现的反射证据。" action={<div className="analysis-tabs">{(['echo','components','timefreq'] as AnalysisView[]).map((item) => <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>{item === 'echo' ? '回波分窗' : item === 'components' ? '共 / 差分量' : '时频图'}</button>)}</div>} />
    <div className="analysis-grid"><section className="plot-panel analysis-plot"><div className="panel-bar"><span>{view === 'echo' ? 'TX VALIDATION + RX ECHO WINDOWS' : view === 'components' ? 'RX COMPONENT SEPARATION' : 'RX-A · STFT PROTOTYPE'}</span><b>DEMO CAPTURE · 2026-07-23</b></div><Chart option={option} className="analysis-chart"/>{view === 'components' && <p className="calibration-note">同相 / 差分仅表示双接收数学分量；未经模态标定，不直接命名为纵向或弯曲模态。</p>}</section>
      <aside className="evidence"><div className="evidence-head"><span>EVIDENCE CHAIN</span><b>04 / 04</b></div>
        <Evidence n="01" title="激励有效" value="0.2 Vpp" copy="TX-A 触发完整；TX-B 为双激励界面演示派生，待硬件实测替换。" tone="tx"/>
        <Evidence n="02" title="接收首波" value={`${directTime.toFixed(1)} μs`} copy="RX-A / RX-B 分别提取，再取一致性时刻。" tone="rx"/>
        <Evidence n="03" title="候选反射" value={`${candidateTime.toFixed(1)} μs`} copy="两路接收在同一时间窗均出现局部峰值。" tone="warn"/>
        <Evidence n="04" title="端面参照" value={`${endTime.toFixed(1)} μs`} copy="2 m 自由端反射为比例定位提供内部标尺。" tone="end"/>
        <div className="position-result"><small>PROPORTIONAL LOCATION</small><strong>{candidatePositionM.toFixed(2)} <em>m</em></strong><span>FROM SENSOR END</span></div>
      </aside>
    </div>
    <section className="window-table"><div className="table-title"><span>WINDOW MEASUREMENTS</span><p>双接收独立分析，不把四曲线当作等价路径。</p></div><div className="table-row head"><span>CHANNEL</span><span>FIRST</span><span>CANDIDATE</span><span>END</span><span>BASELINE CORR.</span></div><div className="table-row"><b className="rx-a">RX-A / Pico F</b><span>{windows.directA.time.toFixed(1)} μs</span><span>{windows.candidateA.time.toFixed(1)} μs</span><span>{windows.endA.time.toFixed(1)} μs</span><span>{corrA.toFixed(1)}%</span></div><div className="table-row"><b className="rx-b">RX-B / Pico G</b><span>{windows.directB.time.toFixed(1)} μs</span><span>{windows.candidateB.time.toFixed(1)} μs</span><span>{windows.endB.time.toFixed(1)} μs</span><span>{corrB.toFixed(1)}%</span></div></section>
  </div>;
}

function Evidence({ n, title, value, copy, tone }: { n: string; title: string; value: string; copy: string; tone: string }) {
  return <div className={`evidence-item ${tone}`}><i>{n}</i><div><span>{title}</span><strong>{value}</strong><p>{copy}</p></div></div>;
}

const sweepFrequencies = [56, 60, 64, 68, 72, 73.7, 76, 80, 84, 88];
const sweepCycles = [3, 5, 7, 9, 11];

function Sweep() {
  const [selected, setSelected] = useState<[number, number]>([5, 2]);
  const data = useMemo(() => sweepFrequencies.flatMap((frequency, x) => sweepCycles.map((cycles, y) => [x, y, Math.round((55 + 40 * Math.exp(-Math.pow((frequency - 73.7) / 10, 2) - Math.pow((cycles - 7) / 3.6, 2))) * 10) / 10])), []);
  const selectedValue = Number(data.find((item) => item[0] === selected[0] && item[1] === selected[1])?.[2] ?? 0);
  const option = useMemo<EChartsOption>(() => ({ animationDuration: 700, grid: { left: 54, right: 18, top: 18, bottom: 42 }, tooltip: { backgroundColor: '#171a1b', borderColor: '#353a3c', textStyle: { color: '#eee' } }, xAxis: { type: 'category', data: sweepFrequencies, axisLabel: { color: '#71797b' }, name: '频率 / kHz' }, yAxis: { type: 'category', data: sweepCycles, axisLabel: { color: '#71797b' }, name: '周期' }, visualMap: { min: 55, max: 95, show: false, inRange: { color: ['#111718', '#17333a', '#1f6970', '#b64c35', '#ffb75d'] } }, series: [{ type: 'heatmap', data, label: { show: true, color: '#d9dddd', fontFamily: 'monospace', formatter: (p: any) => p.data[2] }, itemStyle: { borderColor: '#090b0b', borderWidth: 4 }, emphasis: { itemStyle: { borderColor: '#f4f0e8', borderWidth: 2 } }, markPoint: { symbol: 'circle', symbolSize: 58, data: [{ name: 'selected', coord: selected, itemStyle: { color: 'transparent', borderColor: '#ffb75d', borderWidth: 2, shadowBlur: 18, shadowColor: '#ff6a3d' }, label: { show: false } }] } }] }), [data, selected]);
  return <div className="page sweep"><PageHead index="04" eyebrow="PARAMETER LANDSCAPE" title="不是最大幅值，是最好证据。" copy="推荐工作点同时考虑回波信噪比、激励拖尾与双接收一致性。" action={<button className="outline-button"><RotateCcw size={15}/>重新评估</button>}/><div className="sweep-grid"><section className="plot-panel"><div className="panel-bar"><span>FREQUENCY × CYCLES / COMPOSITE QUALITY</span><b>CLICK TO INSPECT</b></div><Chart option={option} className="heatmap" onClick={(params) => params.data && setSelected([params.data[0], params.data[1]])}/></section><aside className="sweep-result"><small>SELECTED WORKING POINT</small><h2>{sweepFrequencies[selected[0]]}<em>kHz</em></h2><strong>{sweepCycles[selected[1]]} CYCLES</strong><div className="quality"><span>COMPOSITE QUALITY</span><b>{selectedValue.toFixed(1)}</b></div><p>当前点在保持短波包的同时，兼顾端面反射可见度与 RX-A / RX-B 一致性。</p><button>应用到实验 <ArrowRight size={16}/></button></aside></div><section className="factor-strip">{[['ECHO SNR','82'],['LOW RINGING','94'],['RX AGREEMENT','91'],['TX FIDELITY','88']].map(([label,value]) => <div key={label}><small>{label}</small><strong>{value}</strong><i><b style={{ width: `${value}%` }}/></i></div>)}</section></div>;
}

function Health({ onExport }: { onExport: () => void }) {
  const option: EChartsOption = { animationDuration: 800, grid: { left: 42, right: 20, top: 22, bottom: 35 }, xAxis: { type: 'category', data: ['JAN','FEB','MAR','APR','MAY','JUN','JUL','NOW'], axisLabel: { color: '#5f6769' }, axisLine: { lineStyle: { color: '#303536' } } }, yAxis: { type: 'value', min: 60, max: 100, axisLabel: { color: '#5f6769' }, splitLine: { lineStyle: { color: '#1e2223' } } }, series: [{ type: 'line', data: [96,94,92,89,85,81,77,72], smooth: true, showSymbol: false, lineStyle: { color: '#f2b84b', width: 2 }, areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[{ offset: 0, color: 'rgba(242,184,75,.16)' },{ offset: 1, color: 'rgba(242,184,75,0)' }]) } }] };
  return <div className="page health"><PageHead index="05" eyebrow="DECISION LAYER" title="把信号变成复测策略。" copy="健康结论保留证据来源和置信边界，不把前端演示冒充工程标定。" action={<button className="outline-button" onClick={onExport}><Download size={15}/>导出截图</button>}/><div className="health-grid"><section className="health-decision"><div className="decision-top"><span>CURRENT STATE</span><b>ALGORITHM DEMO</b></div><div className="score"><strong>72</strong><span>/ 100</span></div><h2>警戒 / WATCH</h2><p>候选反射在两路接收中重复出现，建议缩短复测周期并观察增长趋势。</p><div className="decision-action"><i>14</i><span><b>DAYS</b>建议复测间隔</span></div></section><section className="plot-panel trend"><div className="panel-bar"><span>HEALTH INDEX / 8 INSPECTIONS</span><b>−17 PT / 6 MONTHS</b></div><Chart option={option} className="trend-chart"/></section></div><section className="decision-logic"><div><small>01 / MEASURED</small><strong>双 RX 候选窗峰值</strong><span>实际采集波形</span></div><ArrowRight/><div><small>02 / DERIVED</small><strong>{candidatePositionM.toFixed(2)} m 位置估计</strong><span>比例飞行时间</span></div><ArrowRight/><div><small>03 / PROTOTYPE</small><strong>警戒状态</strong><span>确定性演示规则</span></div><ArrowRight/><div className="final"><small>04 / ACTION</small><strong>14 天内复测</strong><span>待标定阈值确认</span></div></section><div className="honesty-note"><span>VALIDATION NOTE</span><p>当前数据没有明确物理缺陷标签。界面展示的是完整分析流程原型；真实健康阈值、模态名称与缺陷判据需通过试件实验标定。</p></div></div>;
}

function SystemDrawer({ onClose }: { onClose: () => void }) {
  return <><motion.div className="backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}/><motion.aside className="system-drawer" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 260, damping: 30 }}><header><div><small>HARDWARE TELEMETRY</small><h2>Red Pitaya</h2></div><button onClick={onClose}><X/></button></header><div className="device"><Cpu/><div><strong>STEMlab 125–14 Pro</strong><span>Z7020 Gen2 · 192.168.10.68</span></div><i/></div><div className="telemetry">{[[Thermometer,'TEMPERATURE','48.2 °C','STABLE'],[Activity,'CPU LOAD','23%','4 CORES'],[Database,'MEMORY','41%','382 MB FREE'],[Database,'STORAGE','37%','2.5 GB FREE'],[Zap,'SAMPLE CLOCK','125 MHz','LOCKED'],[Radio,'ADC RATE','5 MS/s','2 CH']].map(([Icon,label,value,note]: any) => <div key={label}><Icon/><small>{label}</small><strong>{value}</strong><span>{note}</span></div>)}</div><footer><span><i/> TELEMETRY ONLINE</span><b>DEMO TELEMETRY</b></footer></motion.aside></>;
}

function DemoGuide({ step, running, onStep, onPause, onClose }: { step: number; running: boolean; onStep: (next: number) => void; onPause: () => void; onClose: () => void }) {
  const item = demoSteps[step];
  return <motion.aside className="demo-guide" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}><div className="demo-count">{String(step + 1).padStart(2,'0')}<span>/ {String(demoSteps.length).padStart(2,'0')}</span></div><div><small>GUIDED NARRATIVE</small><h3>{item.title}</h3><p>{item.copy}</p></div><div className="demo-controls"><button disabled={step === 0} onClick={() => onStep(step - 1)}><ChevronLeft/></button><button onClick={onPause}>{running ? <CirclePause/> : <Play/>}</button><button disabled={step === demoSteps.length - 1} onClick={() => onStep(step + 1)}><ChevronRight/></button><button onClick={onClose}><X/></button></div></motion.aside>;
}

export default function App() {
  const [entered, setEntered] = useState(false);
  const [page, setPage] = useState<PageId>('overview');
  const [systemOpen, setSystemOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [demoRunning, setDemoRunning] = useState(false);
  useEffect(() => { if (!demoOpen || !demoRunning || demoStep >= demoSteps.length - 1) return; const timer = window.setTimeout(() => setDemoStep((value) => value + 1), 12000); return () => window.clearTimeout(timer); }, [demoOpen, demoRunning, demoStep]);
  useEffect(() => { if (demoOpen) setPage(demoSteps[demoStep].page); }, [demoOpen, demoStep]);
  const startDemo = () => { setDemoOpen(true); setDemoRunning(true); setDemoStep(0); setPage('overview'); };
  const exportScreenshot = async () => { const root = document.getElementById('capture-root'); if (!root) return; const url = await toPng(root, { pixelRatio: 2, backgroundColor: '#090b0b' }); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'waveguard-health-demo.png'; anchor.click(); };
  return <AnimatePresence mode="wait">{!entered ? <Landing key="landing" onEnter={() => setEntered(true)}/> : <motion.div key="app" className="app" id="capture-root" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <header className="topbar"><button className="brand-button" onClick={() => setPage('overview')}><Brand/></button><nav>{pages.map((item) => <button key={item.id} onClick={() => setPage(item.id)} className={page === item.id ? 'active' : ''}><span>{item.cn}</span><small>{item.en}</small></button>)}</nav><div className="top-actions"><button onClick={() => setSystemOpen(true)} className="hardware"><i/><span>RP ONLINE</span><b>48.2°C</b></button><button className="demo-trigger" onClick={startDemo}><Sparkles size={14}/>DEMO</button><button className="mobile-menu"><Menu/></button></div></header>
    <main><AnimatePresence mode="wait"><motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .24 }}>{page === 'overview' && <Overview onNavigate={setPage}/>} {page === 'experiment' && <Experiment/>} {page === 'analysis' && <Analysis/>} {page === 'sweep' && <Sweep/>} {page === 'health' && <Health onExport={exportScreenshot}/>}</motion.div></AnimatePresence></main>
    <footer className="app-footer"><span>WAVEGUARD / INSTRUMENT UI</span><span>SAME–END TX × 2 · RX × 2</span><b>PROTOTYPE · DEMO DATA</b></footer>
    <AnimatePresence>{systemOpen && <SystemDrawer onClose={() => setSystemOpen(false)}/>}</AnimatePresence><AnimatePresence>{demoOpen && <DemoGuide step={demoStep} running={demoRunning} onStep={setDemoStep} onPause={() => setDemoRunning((value) => !value)} onClose={() => { setDemoOpen(false); setDemoRunning(false); }}/>}</AnimatePresence>
  </motion.div>}</AnimatePresence>;
}
