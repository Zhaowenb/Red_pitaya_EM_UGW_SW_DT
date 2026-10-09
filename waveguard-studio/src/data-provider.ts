import demoCapture from './demo-capture.json';

export type HealthLevel = 'safe' | 'warning' | 'critical';

export type PathSignal = {
  source: string;
  values: number[];
};

export type CaptureBundle = {
  file: string;
  timeUs: number[];
  channels: PathSignal[];
  sampleRateHz: number;
  frequencyHz: number;
  cycles: number;
  sourceIsSimulated: boolean;
};

export type CapturePair = {
  baseline: CaptureBundle;
  current: CaptureBundle;
  provenance: string;
};

export type AnalysisResult = {
  arrivalTimeUs: number;
  anomalyRangeM: [number, number];
  reflectionRatioDb: number;
  reflectionSnrDb: number;
  baselineCorrelation: number;
  healthIndex: number;
  healthLevel: HealthLevel;
};

export type SweepResult = {
  frequenciesKhz: number[];
  cycles: number[];
  qualityMatrix: number[][];
  recommended: { frequencyKhz: number; cycles: number; score: number };
};

export type SystemSnapshot = {
  connected: boolean;
  temperatureC: number;
  cpuLoadPercent: number;
  memoryUsedPercent: number;
  storageUsedPercent: number;
  sampleRateHz: number;
  clockHz: number;
  model: string;
};

export interface DataProvider {
  getCapturePair(): CapturePair;
  getAnalysisResult(): AnalysisResult;
  getSystemSnapshot(): SystemSnapshot;
}

const bundle = demoCapture as CapturePair;

export const demoDataProvider: DataProvider = {
  getCapturePair: () => bundle,
  getAnalysisResult: () => ({
    arrivalTimeUs: 303.4,
    anomalyRangeM: [0.54, 0.61],
    reflectionRatioDb: -17.9,
    reflectionSnrDb: 15.6,
    baselineCorrelation: 95.4,
    healthIndex: 72,
    healthLevel: 'warning',
  }),
  getSystemSnapshot: () => ({
    connected: true,
    temperatureC: 48.2,
    cpuLoadPercent: 23,
    memoryUsedPercent: 41,
    storageUsedPercent: 37,
    sampleRateHz: 5_000_000,
    clockHz: 125_000_000,
    model: 'STEMlab 125-14 Pro Z7020 Gen2',
  }),
};

// Future hardware integration should implement this interface without changing page components.
export type RedPitayaProvider = DataProvider;
