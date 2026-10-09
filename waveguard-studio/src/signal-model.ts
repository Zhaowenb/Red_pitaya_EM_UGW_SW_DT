import { demoDataProvider, type CaptureBundle } from './data-provider';

export type SignalId = 'TX-A' | 'TX-B' | 'RX-A' | 'RX-B';
export type SignalTrace = { id: SignalId; source: string; values: number[]; color: string; role: string };

export const capturePair = demoDataProvider.getCapturePair();
export const timeUs = capturePair.current.timeUs;

const channel = (capture: CaptureBundle, source: string) =>
  capture.channels.find((item) => item.source === source)?.values ?? capture.channels[0].values;

const center = (values: number[]) => {
  const count = Math.min(72, values.length);
  const offset = values.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  return values.map((value) => value - offset);
};

const normalize = (values: number[]) => {
  const peak = Math.max(...values.map(Math.abs), 1e-6);
  return values.map((value) => value / peak);
};

const shifted = (values: number[], points: number, gain: number) =>
  values.map((_, index) => (index < points ? 0 : values[index - points] * gain));

const txA = normalize(center(channel(capturePair.current, 'H')));
const rxA = normalize(center(channel(capturePair.current, 'F')));
const rxB = normalize(center(channel(capturePair.current, 'G')));

export const traces: SignalTrace[] = [
  { id: 'TX-A', source: 'H', values: txA, color: '#ff5a36', role: '驱动监测 · 触发时刻与输出完整性' },
  { id: 'TX-B', source: 'DEMO', values: shifted(txA, 4, .91), color: '#f2b84b', role: '第二激励监测 · 相位与幅值平衡' },
  { id: 'RX-A', source: 'F', values: rxA, color: '#52d6ff', role: '接收通道 · 直达波、缺陷回波与端面回波' },
  { id: 'RX-B', source: 'G', values: rxB, color: '#71e6a4', role: '接收通道 · 独立证据与一致性复核' },
];

export const receiverComponents = {
  common: rxA.map((value, index) => (value + rxB[index]) / 2),
  difference: rxA.map((value, index) => (value - rxB[index]) / 2),
};

export const baselineReceivers = {
  a: normalize(center(channel(capturePair.baseline, 'F'))),
  b: normalize(center(channel(capturePair.baseline, 'G'))),
};

export const correlation = (a: number[], b: number[]) => {
  const count = Math.min(a.length, b.length);
  const ma = a.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  const mb = b.slice(0, count).reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let da = 0;
  let db = 0;
  for (let index = 0; index < count; index += 1) {
    const av = a[index] - ma;
    const bv = b[index] - mb;
    numerator += av * bv;
    da += av * av;
    db += bv * bv;
  }
  return numerator / Math.sqrt(Math.max(da * db, 1e-12));
};

export const peakIn = (values: number[], start: number, end: number) => {
  let winner = { time: start, value: 0 };
  timeUs.forEach((time, index) => {
    if (time >= start && time <= end && Math.abs(values[index]) > Math.abs(winner.value)) {
      winner = { time, value: values[index] };
    }
  });
  return winner;
};

const rxATrace = traces[2].values;
const rxBTrace = traces[3].values;
export const windows = {
  directA: peakIn(rxATrace, 70, 150),
  directB: peakIn(rxBTrace, 70, 150),
  candidateA: peakIn(rxATrace, 240, 360),
  candidateB: peakIn(rxBTrace, 240, 360),
  endA: peakIn(rxATrace, 740, 870),
  endB: peakIn(rxBTrace, 740, 870),
};

export const directTime = (windows.directA.time + windows.directB.time) / 2;
export const candidateTime = (windows.candidateA.time + windows.candidateB.time) / 2;
export const endTime = (windows.endA.time + windows.endB.time) / 2;
export const candidatePositionM = 2 * (candidateTime - directTime) / (endTime - directTime);

export const waveformData = (values: number[]) => timeUs.map((time, index) => [time, values[index]]);
