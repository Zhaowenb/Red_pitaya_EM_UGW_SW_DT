#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <stdexcept>
#include <vector>

namespace hann_scope {

struct HannBurst {
    std::vector<float> samples;
    double peak_scale;
};

inline double pi() {
    return 3.141592653589793238462643383279502884;
}

// Produces one AWG-buffer period containing an integer-cycle Hann tone burst.
// The waveform is normalized so the user-facing amplitude is the actual peak.
inline HannBurst make_hann_burst(std::size_t sample_count, int cycles) {
    if (sample_count < 2) {
        throw std::invalid_argument("sample_count must be at least 2");
    }
    if (cycles < 1) {
        throw std::invalid_argument("cycles must be positive");
    }

    HannBurst result;
    result.samples.resize(sample_count, 0.0f);
    double raw_peak = 0.0;
    const double denominator = static_cast<double>(sample_count - 1);

    for (std::size_t i = 0; i < sample_count; ++i) {
        const double phase = static_cast<double>(i) / denominator;
        const double window = 0.5 * (1.0 - std::cos(2.0 * pi() * phase));
        const double carrier = std::sin(2.0 * pi() * static_cast<double>(cycles) * phase);
        const double value = window * carrier;
        result.samples[i] = static_cast<float>(value);
        raw_peak = std::max(raw_peak, std::fabs(value));
    }

    if (raw_peak <= 0.0) {
        throw std::runtime_error("generated waveform has zero peak");
    }

    result.peak_scale = 1.0 / raw_peak;
    for (std::size_t i = 0; i < result.samples.size(); ++i) {
        result.samples[i] = static_cast<float>(result.samples[i] * result.peak_scale);
    }
    return result;
}

inline float evaluate_hann_burst(double time_s,
                                 double carrier_frequency_hz,
                                 int cycles,
                                 double peak_scale,
                                 double amplitude_v) {
    const double duration_s = static_cast<double>(cycles) / carrier_frequency_hz;
    if (time_s < 0.0 || time_s > duration_s) {
        return 0.0f;
    }

    const double phase = time_s / duration_s;
    const double window = 0.5 * (1.0 - std::cos(2.0 * pi() * phase));
    const double carrier = std::sin(2.0 * pi() * carrier_frequency_hz * time_s);
    return static_cast<float>(amplitude_v * peak_scale * window * carrier);
}

}  // namespace hann_scope
