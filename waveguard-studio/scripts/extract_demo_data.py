"""Extract a browser-sized, deterministic demo bundle from the two newest Pico captures."""

from __future__ import annotations

import json
import argparse
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
PICO_DATA = ROOT.parent.parent / "Pico_4824A" / "data"
OUTPUT = ROOT / "src" / "demo-capture.json"


def load_capture(path: Path) -> dict:
    with np.load(path, allow_pickle=False) as archive:
        metadata = json.loads(str(archive["metadata_json"].item()))
        channel_names = [key for key in archive.files if key.startswith("ch_")]
        preferred = [key for key in ("ch_B_v", "ch_F_v", "ch_G_v", "ch_H_v") if key in channel_names]
        selected = (preferred + [key for key in channel_names if key not in preferred])[:4]

        time = archive["time_s"] * 1e6
        indices = np.linspace(0, len(time) - 1, 900, dtype=int)
        channels = []
        for key in selected:
            values = archive[key][indices]
            channels.append({
                "source": key.removeprefix("ch_").removesuffix("_v").upper(),
                "values": [round(float(value) * 1000.0, 5) for value in values],
            })

        config = metadata.get("config", {})
        awg = config.get("awg", {})
        return {
            "file": path.name,
            "timeUs": [round(float(value), 4) for value in time[indices]],
            "channels": channels,
            "sampleRateHz": metadata.get("actual_sample_rate_hz", 5_000_000),
            "frequencyHz": awg.get("frequency_hz", 73_700),
            "cycles": awg.get("cycles", 7),
            "sourceIsSimulated": metadata.get("simulated", False),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=PICO_DATA)
    args = parser.parse_args()
    captures = sorted(args.data_dir.glob("capture_*.npz"), key=lambda item: item.stat().st_mtime, reverse=True)
    if len(captures) < 2:
        raise SystemExit(f"Need at least two capture_*.npz files in {args.data_dir}")

    current = load_capture(captures[0])
    baseline = load_capture(captures[1])
    payload = {
        "provenance": "PicoScope captured waveform, downsampled for the WaveGuard frontend demo",
        "baseline": baseline,
        "current": current,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} from {baseline['file']} and {current['file']}")


if __name__ == "__main__":
    main()
