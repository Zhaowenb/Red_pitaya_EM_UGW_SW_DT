#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <sys/statvfs.h>
#include <sys/sysinfo.h>
#include <unistd.h>
#include <vector>

#include "main.h"
#include "rp.h"
#include "rp_hw.h"
#include "rp_hw-profiles.h"
#include "waveform.h"

namespace {

const int kAwgSize = 16384;
const int kAdcBufferSize = 16384;
const uint32_t kDecimation = 80;
const double kCaptureSeconds = 0.010;
const int kCaptureSamples = 15625;
const int kArmDelayUs = 12000;
const int kHardwareTimeoutMs = 750;

enum StatusCode {
    STATUS_IDLE = 0,
    STATUS_ARMED = 1,
    STATUS_ACQUIRING = 2,
    STATUS_COMPLETE = 3,
    STATUS_ERROR = 4,
    STATUS_STOPPED = 5
};

CFloatParameter FREQUENCY_HZ("FREQUENCY_HZ", CBaseParameter::RW, 80000.0f, 0, 1000.0f, 500000.0f);
CIntParameter CYCLES("CYCLES", CBaseParameter::RW, 5, 0, 1, 100);
CFloatParameter AMPLITUDE_V("AMPLITUDE_V", CBaseParameter::RW, 0.1f, 0, 0.0f, 0.9f);
CIntParameter RUN("RUN", CBaseParameter::RW, 0, 0, 0, 1);
CIntParameter STOP("STOP", CBaseParameter::RW, 0, 0, 0, 1);

CIntParameter STATUS_CODE("STATUS_CODE", CBaseParameter::RO, STATUS_IDLE, 0, STATUS_IDLE, STATUS_STOPPED);
CStringParameter STATUS_TEXT("STATUS_TEXT", CBaseParameter::RO, "Ready", 0);
CIntParameter TRACE_SEQUENCE("TRACE_SEQUENCE", CBaseParameter::RO, 0, 0, 0, std::numeric_limits<int>::max());
CIntParameter TRACE_SIZE("TRACE_SIZE", CBaseParameter::RO, 0, 0, 0, kAdcBufferSize);
CFloatParameter SAMPLE_RATE_HZ("SAMPLE_RATE_HZ", CBaseParameter::RO, 1562500.0f, 0, 1.0f, 125000000.0f);
CIntParameter DECIMATION("DECIMATION", CBaseParameter::RO, static_cast<int>(kDecimation), 0, 1, 65536);
CFloatParameter CAPTURE_MS("CAPTURE_MS", CBaseParameter::RO, 10.0f, 0, 0.0f, 100000.0f);
CFloatParameter BURST_US("BURST_US", CBaseParameter::RO, 62.5f, 0, 0.0f, 1000000.0f);
CFloatParameter ADC_PEAK_V("ADC_PEAK_V", CBaseParameter::RO, 0.0f, 0, 0.0f, 100.0f);
CFloatParameter ADC_RMS_V("ADC_RMS_V", CBaseParameter::RO, 0.0f, 0, 0.0f, 100.0f);
CFloatParameter TEMPERATURE_C("TEMPERATURE_C", CBaseParameter::RO, 0.0f, 0, -50.0f, 150.0f);
CFloatParameter LOAD_1M("LOAD_1M", CBaseParameter::RO, 0.0f, 0, 0.0f, 1000.0f);
CFloatParameter MEMORY_USED_PCT("MEMORY_USED_PCT", CBaseParameter::RO, 0.0f, 0, 0.0f, 100.0f);
CFloatParameter DISK_USED_PCT("DISK_USED_PCT", CBaseParameter::RO, 0.0f, 0, 0.0f, 100.0f);
CFloatParameter UPTIME_S("UPTIME_S", CBaseParameter::RO, 0.0f, 0, 0.0f, 1.0e9f);
CStringParameter MODEL_NAME("MODEL_NAME", CBaseParameter::RO, "Red Pitaya", 0);
CStringParameter OS_VERSION("OS_VERSION", CBaseParameter::RO, "Unknown", 0);

CFloatSignal ADC_TRACE("ADC_TRACE", 1, 0.0f);
CFloatSignal EXPECTED_TRACE("EXPECTED_TRACE", 1, 0.0f);

bool g_initialized = false;
bool g_busy = false;
int g_trace_sequence = 0;
uint32_t g_adc_base_rate_hz = 125000000;

std::string trim(const std::string& value) {
    const std::string whitespace = " \t\r\n";
    const std::size_t start = value.find_first_not_of(whitespace);
    if (start == std::string::npos) {
        return std::string();
    }
    const std::size_t end = value.find_last_not_of(whitespace);
    return value.substr(start, end - start + 1);
}

std::string read_os_version() {
    std::ifstream input("/opt/redpitaya/version.txt");
    std::string line;
    std::string version;
    std::string build;
    while (std::getline(input, line)) {
        const std::size_t version_pos = line.find("# Version:");
        const std::size_t build_pos = line.find("# Build:");
        if (version_pos != std::string::npos) {
            version = trim(line.substr(version_pos + 10));
        } else if (build_pos != std::string::npos) {
            build = trim(line.substr(build_pos + 8));
        }
    }
    if (version.empty()) {
        return "Unknown";
    }
    return build.empty() ? version : version + " build " + build;
}

void set_status(StatusCode code, const std::string& text) {
    STATUS_CODE.SendValue(static_cast<int>(code));
    STATUS_TEXT.SendValue(text);
}

bool check_result(int result, const char* operation) {
    if (result == RP_OK) {
        return true;
    }
    std::ostringstream message;
    message << operation << " failed (RP error " << result << ")";
    set_status(STATUS_ERROR, message.str());
    std::fprintf(stderr, "hann_scope: %s\n", message.str().c_str());
    return false;
}

void safe_stop_hardware() {
    if (!g_initialized) {
        return;
    }
    rp_GenOutDisable(RP_CH_1);
    rp_AcqStop();
}

void update_telemetry() {
    if (!g_initialized) {
        return;
    }

    uint32_t raw_temperature = 0;
    const float temperature = rp_GetCPUTemperature(&raw_temperature);
    if (std::isfinite(temperature)) {
        TEMPERATURE_C.SendValue(temperature);
    }

    struct sysinfo info;
    if (sysinfo(&info) == 0) {
        const double load = static_cast<double>(info.loads[0]) / 65536.0;
        const double total = static_cast<double>(info.totalram) * info.mem_unit;
        const double free = static_cast<double>(info.freeram) * info.mem_unit;
        LOAD_1M.SendValue(static_cast<float>(load));
        UPTIME_S.SendValue(static_cast<float>(info.uptime));
        if (total > 0.0) {
            MEMORY_USED_PCT.SendValue(static_cast<float>(100.0 * (total - free) / total));
        }
    }

    struct statvfs disk;
    if (statvfs("/", &disk) == 0 && disk.f_blocks > 0) {
        const double used = static_cast<double>(disk.f_blocks - disk.f_bavail);
        DISK_USED_PCT.SendValue(static_cast<float>(100.0 * used / disk.f_blocks));
    }
}

bool wait_for_trigger() {
    const std::chrono::steady_clock::time_point deadline =
        std::chrono::steady_clock::now() + std::chrono::milliseconds(kHardwareTimeoutMs);
    while (std::chrono::steady_clock::now() < deadline) {
        rp_acq_trig_state_t state = RP_TRIG_STATE_WAITING;
        const int result = rp_AcqGetTriggerState(&state);
        if (!check_result(result, "rp_AcqGetTriggerState")) {
            return false;
        }
        if (state == RP_TRIG_STATE_TRIGGERED) {
            return true;
        }
        usleep(100);
    }
    set_status(STATUS_ERROR, "ADC trigger timeout");
    return false;
}

bool wait_for_buffer_fill() {
    const std::chrono::steady_clock::time_point deadline =
        std::chrono::steady_clock::now() + std::chrono::milliseconds(kHardwareTimeoutMs);
    while (std::chrono::steady_clock::now() < deadline) {
        bool filled = false;
        const int result = rp_AcqGetBufferFillState(&filled);
        if (!check_result(result, "rp_AcqGetBufferFillState")) {
            return false;
        }
        if (filled) {
            return true;
        }
        usleep(100);
    }
    set_status(STATUS_ERROR, "ADC buffer fill timeout");
    return false;
}

bool configure_generator(const hann_scope::HannBurst& burst,
                         double carrier_frequency_hz,
                         int cycles,
                         double amplitude_v) {
    const double awg_period_frequency_hz = carrier_frequency_hz / static_cast<double>(cycles);
    const double burst_duration_us = 1.0e6 / awg_period_frequency_hz;
    const uint32_t repetition_period_us =
        static_cast<uint32_t>(std::ceil(burst_duration_us)) + 10U;

    if (!check_result(rp_GenReset(), "rp_GenReset") ||
        !check_result(rp_GenOutDisable(RP_CH_1), "rp_GenOutDisable") ||
        !check_result(rp_GenWaveform(RP_CH_1, RP_WAVEFORM_ARBITRARY), "rp_GenWaveform") ||
        !check_result(rp_GenArbWaveform(RP_CH_1,
                                       const_cast<float*>(burst.samples.data()),
                                       static_cast<int>(burst.samples.size())),
                      "rp_GenArbWaveform") ||
        !check_result(rp_GenFreqDirect(RP_CH_1, static_cast<float>(awg_period_frequency_hz)),
                      "rp_GenFreqDirect") ||
        !check_result(rp_GenAmp(RP_CH_1, static_cast<float>(amplitude_v)), "rp_GenAmp") ||
        !check_result(rp_GenOffset(RP_CH_1, 0.0f), "rp_GenOffset") ||
        !check_result(rp_GenMode(RP_CH_1, RP_GEN_MODE_BURST), "rp_GenMode") ||
        !check_result(rp_GenBurstCount(RP_CH_1, 1), "rp_GenBurstCount") ||
        !check_result(rp_GenBurstRepetitions(RP_CH_1, 1), "rp_GenBurstRepetitions") ||
        !check_result(rp_GenBurstPeriod(RP_CH_1, repetition_period_us), "rp_GenBurstPeriod") ||
        !check_result(rp_GenBurstLastValue(RP_CH_1, 0.0f), "rp_GenBurstLastValue") ||
        !check_result(rp_GenTriggerSource(RP_CH_1, RP_GEN_TRIG_SRC_INTERNAL),
                      "rp_GenTriggerSource")) {
        return false;
    }
    return true;
}

bool configure_acquisition() {
    // rp_AcqSetTriggerDelay() is relative to the centre of the 16,384-sample
    // buffer. Request exactly kCaptureSamples after the hardware trigger.
    const int32_t trigger_delay = kCaptureSamples - (kAdcBufferSize / 2);
    if (!check_result(rp_AcqReset(), "rp_AcqReset") ||
        !check_result(rp_AcqSetDecimationFactor(kDecimation), "rp_AcqSetDecimationFactor") ||
        !check_result(rp_AcqSetGain(RP_CH_1, RP_LOW), "rp_AcqSetGain") ||
        !check_result(rp_AcqSetTriggerDelay(trigger_delay), "rp_AcqSetTriggerDelay") ||
        !check_result(rp_AcqStart(), "rp_AcqStart")) {
        return false;
    }
    return true;
}

void publish_trace(const std::vector<float>& adc,
                   const hann_scope::HannBurst& burst,
                   double frequency_hz,
                   int cycles,
                   double amplitude_v) {
    const double sample_rate_hz = static_cast<double>(g_adc_base_rate_hz) / kDecimation;
    std::vector<float> expected(adc.size(), 0.0f);
    double peak = 0.0;
    double square_sum = 0.0;

    for (std::size_t i = 0; i < adc.size(); ++i) {
        const double time_s = static_cast<double>(i) / sample_rate_hz;
        expected[i] = hann_scope::evaluate_hann_burst(
            time_s, frequency_hz, cycles, burst.peak_scale, amplitude_v);
        peak = std::max(peak, std::fabs(static_cast<double>(adc[i])));
        square_sum += static_cast<double>(adc[i]) * adc[i];
    }

    ADC_TRACE.Set(adc);
    EXPECTED_TRACE.Set(expected);
    ADC_PEAK_V.SendValue(static_cast<float>(peak));
    ADC_RMS_V.SendValue(adc.empty() ? 0.0f : static_cast<float>(std::sqrt(square_sum / adc.size())));
    TRACE_SIZE.SendValue(static_cast<int>(adc.size()));
    TRACE_SEQUENCE.SendValue(++g_trace_sequence);
}

bool perform_measurement() {
    if (g_busy) {
        set_status(STATUS_ERROR, "A measurement is already running");
        return false;
    }
    g_busy = true;

    const double frequency_hz = FREQUENCY_HZ.Value();
    const int cycles = CYCLES.Value();
    const double amplitude_v = AMPLITUDE_V.Value();
    BURST_US.SendValue(static_cast<float>(1.0e6 * cycles / frequency_hz));

    hann_scope::HannBurst burst;
    try {
        burst = hann_scope::make_hann_burst(kAwgSize, cycles);
    } catch (const std::exception& error) {
        set_status(STATUS_ERROR, error.what());
        g_busy = false;
        return false;
    }

    set_status(STATUS_ARMED, "Configuring AWG and arming ADC");
    if (!configure_generator(burst, frequency_hz, cycles, amplitude_v) ||
        !configure_acquisition()) {
        safe_stop_hardware();
        g_busy = false;
        return false;
    }

    // Fill the circular buffer with fresh samples before exposing the trigger.
    usleep(kArmDelayUs);
    if (!check_result(rp_AcqSetTriggerSrc(RP_TRIG_SRC_AWG_PE), "rp_AcqSetTriggerSrc") ||
        !check_result(rp_GenOutEnable(RP_CH_1), "rp_GenOutEnable")) {
        safe_stop_hardware();
        g_busy = false;
        return false;
    }

    set_status(STATUS_ACQUIRING, "Triggered; collecting 10 ms from IN1");
    const std::chrono::steady_clock::time_point burst_deadline =
        std::chrono::steady_clock::now() +
        std::chrono::microseconds(static_cast<int64_t>(
            std::ceil(1.0e6 * cycles / frequency_hz)) + 100);
    if (!check_result(rp_GenTriggerOnly(RP_CH_1), "rp_GenTriggerOnly")) {
        safe_stop_hardware();
        g_busy = false;
        return false;
    }
    if (!wait_for_trigger() || !wait_for_buffer_fill()) {
        safe_stop_hardware();
        g_busy = false;
        return false;
    }

    rp_AcqStop();
    const std::chrono::steady_clock::time_point now = std::chrono::steady_clock::now();
    if (now < burst_deadline) {
        const int64_t remaining_us =
            std::chrono::duration_cast<std::chrono::microseconds>(burst_deadline - now).count();
        usleep(static_cast<useconds_t>(remaining_us));
    }
    rp_GenOutDisable(RP_CH_1);

    uint32_t trigger_position = 0;
    uint32_t sample_count = kCaptureSamples;
    std::vector<float> adc(sample_count, 0.0f);
    if (!check_result(rp_AcqGetWritePointerAtTrig(&trigger_position),
                      "rp_AcqGetWritePointerAtTrig") ||
        !check_result(rp_AcqGetDataV(RP_CH_1, trigger_position, &sample_count, adc.data()),
                      "rp_AcqGetDataV")) {
        safe_stop_hardware();
        g_busy = false;
        return false;
    }
    adc.resize(sample_count);
    publish_trace(adc, burst, frequency_hz, cycles, amplitude_v);
    set_status(STATUS_COMPLETE, "Capture complete; output is off");
    g_busy = false;
    return true;
}

void apply_parameter_updates() {
    if (FREQUENCY_HZ.IsNewValue()) {
        FREQUENCY_HZ.Update();
    }
    if (CYCLES.IsNewValue()) {
        CYCLES.Update();
    }
    if (AMPLITUDE_V.IsNewValue()) {
        AMPLITUDE_V.Update();
    }

    if (STOP.IsNewValue()) {
        STOP.Update();
        if (STOP.Value() == 1) {
            safe_stop_hardware();
            set_status(STATUS_STOPPED, "Output stopped");
            STOP.SendValue(0);
        }
    }

    if (RUN.IsNewValue()) {
        RUN.Update();
        if (RUN.Value() == 1) {
            perform_measurement();
            RUN.SendValue(0);
        }
    }
}

}  // namespace

const char* rp_app_desc(void) {
    return "Hann-windowed tone burst generator with synchronized 10 ms capture.\n";
}

int rp_app_init(void) {
    std::fprintf(stderr, "Loading Hann Scope application\n");
    CDataManager::GetInstance()->SetParamInterval(1000);
    CDataManager::GetInstance()->SetSignalInterval(100);

    const int init_result = rp_Init();
    if (init_result != RP_OK) {
        std::fprintf(stderr, "hann_scope: rp_Init failed (%d)\n", init_result);
        set_status(STATUS_ERROR, "Red Pitaya API initialization failed");
        return EXIT_FAILURE;
    }
    g_initialized = true;
    safe_stop_hardware();

    g_adc_base_rate_hz = rp_HPGetBaseFastADCSpeedHzOrDefault();
    SAMPLE_RATE_HZ.SendValue(static_cast<float>(g_adc_base_rate_hz) / kDecimation);
    DECIMATION.SendValue(static_cast<int>(kDecimation));
    CAPTURE_MS.SendValue(static_cast<float>(1000.0 * kCaptureSeconds));

    char* model_name = nullptr;
    if (rp_HPGetModelName(&model_name) == RP_HP_OK && model_name != nullptr) {
        MODEL_NAME.SendValue(model_name);
    }
    OS_VERSION.SendValue(read_os_version());
    update_telemetry();
    set_status(STATUS_IDLE, "Ready; output is off");
    return EXIT_SUCCESS;
}

int rp_app_exit(void) {
    std::fprintf(stderr, "Unloading Hann Scope application\n");
    safe_stop_hardware();
    if (g_initialized) {
        rp_Release();
        g_initialized = false;
    }
    return EXIT_SUCCESS;
}

int rp_set_params(rp_app_params_t*, int) {
    return 0;
}

int rp_get_params(rp_app_params_t**) {
    return 0;
}

int rp_get_signals(float***, int*, int*) {
    return 0;
}

void UpdateSignals(void) {}

void UpdateParams(void) {
    update_telemetry();
}

void OnNewParams(void) {
    apply_parameter_updates();
}

void OnNewSignals(void) {}

void PostUpdateSignals(void) {}
