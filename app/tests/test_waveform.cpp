#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>

#include "../src/waveform.h"

int main() {
    const std::size_t sample_count = 16384;
    const int cycles = 5;
    const double frequency_hz = 80000.0;
    const hann_scope::HannBurst burst = hann_scope::make_hann_burst(sample_count, cycles);

    assert(burst.samples.size() == sample_count);
    assert(std::fabs(burst.samples.front()) < 1.0e-7);
    assert(std::fabs(burst.samples.back()) < 1.0e-7);

    double peak = 0.0;
    for (std::size_t i = 0; i < burst.samples.size(); ++i) {
        assert(std::isfinite(burst.samples[i]));
        peak = std::max(peak, std::fabs(static_cast<double>(burst.samples[i])));
    }
    assert(std::fabs(peak - 1.0) < 1.0e-6);

    const double duration_s = static_cast<double>(cycles) / frequency_hz;
    assert(std::fabs(duration_s - 62.5e-6) < 1.0e-12);
    assert(std::fabs(hann_scope::evaluate_hann_burst(
                         0.0, frequency_hz, cycles, burst.peak_scale, 0.1)) < 1.0e-7);
    assert(std::fabs(hann_scope::evaluate_hann_burst(
                         duration_s, frequency_hz, cycles, burst.peak_scale, 0.1)) < 1.0e-7);
    assert(hann_scope::evaluate_hann_burst(
               duration_s + 1.0e-9, frequency_hz, cycles, burst.peak_scale, 0.1) == 0.0f);

    std::cout << "waveform tests passed\n";
    return 0;
}
