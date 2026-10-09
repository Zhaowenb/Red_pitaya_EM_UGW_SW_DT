// Single-owner Red Pitaya acquisition service. Local socket only; no network listener.
#include <rp.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstring>
#include <iostream>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

static std::atomic<bool> cancelled{false}, quitting{false};
static std::mutex hardware_lock;
using Clock = std::chrono::steady_clock;
static void check(int code, const char* operation) {
    if (code != RP_OK) throw std::runtime_error(std::string(operation)+": "+rp_GetError(code));
}
#define RP_CHECK(call) check((call), #call)
static void off() {
    rp_GenOutDisable(RP_CH_1); rp_GenOutDisable(RP_CH_2); rp_AcqStop();
    rp_AcqAxiEnable(RP_CH_1,false); rp_AcqAxiEnable(RP_CH_2,false);
}
struct ShutdownGuard { ~ShutdownGuard() { off(); } };
static void exact_read(int fd, void* ptr, size_t size) {
    auto data=static_cast<char*>(ptr);
    while (size) { auto count=recv(fd,data,size,0); if(count<=0) throw std::runtime_error("Client disconnected"); data+=count; size-=count; }
}
static void exact_write(int fd, const void* ptr, size_t size) {
    auto data=static_cast<const char*>(ptr);
    while(size) { auto count=send(fd,data,size,MSG_NOSIGNAL); if(count<=0) throw std::runtime_error("Client disconnected"); data+=count; size-=count; }
}
static void text(int fd,const std::string& data) { exact_write(fd,data.data(),data.size()); }
static void poll_check(Clock::time_point deadline, int fd) {
    if(cancelled || quitting) throw std::runtime_error("Stopped");
    if(Clock::now()>deadline) throw std::runtime_error("Trigger/acquisition timeout");
    char c; auto received=recv(fd,&c,1,MSG_PEEK|MSG_DONTWAIT);
    if(received==0) throw std::runtime_error("Client disconnected");
    std::this_thread::sleep_for(std::chrono::microseconds(100));
}
struct Output { uint32_t count; float frequency,amplitude,offset,phase; int cycles; std::vector<float> waveform; };
static void capture(int fd,std::istringstream& input) {
    std::unique_lock<std::mutex> lock(hardware_lock,std::try_to_lock);
    if(!lock.owns_lock()) throw std::runtime_error("Hardware busy");
    ShutdownGuard guard;
    cancelled=false;
    uint32_t dec,n,pre; int mask,source,falling,gain1,gain2; float level; double timeout;
    if(!(input>>dec>>n>>pre>>mask>>source>>falling>>level>>timeout>>gain1>>gain2)) throw std::runtime_error("Bad header");
    if(n<32 || n>2000000 || pre>=n || mask<0 || mask>3 || source<0 || source>4 ||
       !std::isfinite(timeout) || timeout<=0 || timeout>120 || !std::isfinite(level) ||
       !(dec==1 || dec==2 || dec==4 || dec==8 || (dec>=16 && dec<=65536))) throw std::runtime_error("Invalid capture limits");
    Output outputs[2];
    double burst_seconds=0;
    for(int i=0;i<2;++i) {
        auto& out=outputs[i];
        if(!(input>>out.count>>out.frequency>>out.amplitude>>out.offset>>out.phase>>out.cycles)) throw std::runtime_error("Bad output header");
        if(out.count!=16384 || !std::isfinite(out.frequency) || out.frequency<=0 || out.frequency>1000000 ||
           !std::isfinite(out.amplitude) || out.amplitude<=0 || !std::isfinite(out.offset) || std::abs(out.offset)+out.amplitude>1.801 ||
           !std::isfinite(out.phase) || out.cycles<1 || out.cycles>100000) throw std::runtime_error("Invalid output limits");
        if(mask&(1<<i)) burst_seconds=std::max(burst_seconds,out.cycles/double(out.frequency));
        out.waveform.resize(out.count);
    }
    if(burst_seconds>timeout) throw std::runtime_error("Burst exceeds task timeout");
    for(auto& out:outputs) {
        exact_read(fd,out.waveform.data(),out.count*sizeof(float));
        for(float value:out.waveform) if(!std::isfinite(value) || std::abs(value)>1.0001) throw std::runtime_error("Invalid waveform");
    }
    off(); RP_CHECK(rp_AcqReset()); RP_CHECK(rp_GenReset());
    RP_CHECK(rp_AcqSetGain(RP_CH_1,gain1?RP_HIGH:RP_LOW));
    RP_CHECK(rp_AcqSetGain(RP_CH_2,gain2?RP_HIGH:RP_LOW));
    RP_CHECK(rp_AcqSetDecimationFactor(dec));
    const bool deep=n>16384;
    // AXI maps each channel through mmap: the second start address must be
    // page-aligned, not merely aligned to the FPGA's 8-sample granularity.
    const long page_bytes=sysconf(_SC_PAGESIZE);
    if(page_bytes<=0 || page_bytes%2) throw std::runtime_error("Invalid memory page size");
    const uint32_t alignment=std::max(uint32_t(8),uint32_t(page_bytes/2));
    const uint32_t buffer=((n+alignment-1)/alignment)*alignment;
    if(deep) {
        uint32_t address=0,bytes=0;
        RP_CHECK(rp_AcqAxiGetMemoryRegion(&address,&bytes));
        if(uint64_t(buffer)*4>bytes) throw std::runtime_error("DDR acquisition region too small");
        RP_CHECK(rp_AcqAxiSetDecimationFactor(dec));
        for(int i=0;i<2;++i) {
            auto channel=static_cast<rp_channel_t>(i);
            RP_CHECK(rp_AcqAxiSetBufferSamples(channel,address+i*buffer*2,buffer));
            RP_CHECK(rp_AcqAxiSetTriggerDelay(channel,n-pre));
            RP_CHECK(rp_AcqAxiEnable(channel,true));
        }
    } else { RP_CHECK(rp_AcqSetTriggerDelay(int(n-pre)-8192)); }
    for(int i=0;i<2;++i) if(mask&(1<<i)) {
        auto channel=static_cast<rp_channel_t>(i); auto& out=outputs[i];
        RP_CHECK(rp_GenWaveform(channel,RP_WAVEFORM_ARBITRARY));
        RP_CHECK(rp_GenArbWaveform(channel,out.waveform.data(),out.count));
        RP_CHECK(rp_GenFreq(channel,out.frequency));
        RP_CHECK(rp_GenSetLoadMode(channel,RP_GEN_HI_Z));
        RP_CHECK(rp_GenAmp(channel,out.amplitude)); RP_CHECK(rp_GenOffset(channel,out.offset));
        RP_CHECK(rp_GenPhase(channel,out.phase)); RP_CHECK(rp_GenMode(channel,RP_GEN_MODE_BURST));
        RP_CHECK(rp_GenBurstCount(channel,out.cycles)); RP_CHECK(rp_GenBurstRepetitions(channel,1));
        RP_CHECK(rp_GenBurstPeriod(channel,float(out.cycles/out.frequency*1e6+10)));
        // With EXT triggering, both the generator and acquisition must wait
        // for the same physical edge.  Software-triggering the generator here
        // used to emit the burst before the external ADC trigger arrived.
        const auto generator_trigger = source==4
            ? (falling ? RP_GEN_TRIG_SRC_EXT_NE : RP_GEN_TRIG_SRC_EXT_PE)
            : RP_GEN_TRIG_SRC_INTERNAL;
        RP_CHECK(rp_GenTriggerSource(channel,generator_trigger));
        RP_CHECK(rp_GenBurstLastValue(channel,0)); RP_CHECK(rp_GenOutEnable(channel));
    }
    RP_CHECK(rp_GenSynchronise());
    if(source==2 || source==3) RP_CHECK(rp_AcqSetTriggerLevel(source==2?RP_T_CH_1:RP_T_CH_2,level));
    RP_CHECK(rp_AcqSetTriggerSrc(RP_TRIG_SRC_DISABLED)); RP_CHECK(rp_AcqStart());
    auto deadline=Clock::now()+std::chrono::milliseconds(int(timeout*1000));
    auto ready=Clock::now()+std::chrono::microseconds(int64_t((pre+32)*double(dec)/125000000*1e6)+1000);
    while(Clock::now()<ready) poll_check(deadline,fd);
    rp_acq_trig_src_t trigger=RP_TRIG_SRC_NOW;
    if(source==1) trigger=RP_TRIG_SRC_AWG_PE;
    if(source==2) trigger=falling?RP_TRIG_SRC_CHA_NE:RP_TRIG_SRC_CHA_PE;
    if(source==3) trigger=falling?RP_TRIG_SRC_CHB_NE:RP_TRIG_SRC_CHB_PE;
    if(source==4) trigger=falling?RP_TRIG_SRC_EXT_NE:RP_TRIG_SRC_EXT_PE;
    RP_CHECK(rp_AcqSetTriggerSrc(trigger));
    if(source!=4) {
        if(mask==3) { RP_CHECK(rp_GenTriggerOnlyBoth()); }
        else if(mask) { RP_CHECK(rp_GenTriggerOnly(mask==1?RP_CH_1:RP_CH_2)); }
    }
    auto burst_end=Clock::now()+std::chrono::microseconds(int64_t(burst_seconds*1e6)+100);
    rp_acq_trig_state_t state=RP_TRIG_STATE_WAITING;
    while(state!=RP_TRIG_STATE_TRIGGERED) { poll_check(deadline,fd); RP_CHECK(rp_AcqGetTriggerState(&state)); }
    // External edges may arrive long after arming. Do not count that waiting
    // interval as output time and cut a long burst short after a short capture.
    if(source==4) burst_end=Clock::now()+std::chrono::microseconds(int64_t(burst_seconds*1e6)+100);
    bool filled=false;
    while(!filled) {
        poll_check(deadline,fd);
        if(deep) { bool second=false; RP_CHECK(rp_AcqAxiGetBufferFillState(RP_CH_1,&filled)); RP_CHECK(rp_AcqAxiGetBufferFillState(RP_CH_2,&second)); filled=filled&&second; }
        else RP_CHECK(rp_AcqGetBufferFillState(&filled));
    }
    RP_CHECK(rp_AcqStop());
    while(mask && Clock::now()<burst_end) poll_check(deadline,fd);
    rp_GenOutDisable(RP_CH_1); rp_GenOutDisable(RP_CH_2);
    std::vector<float> data[2];
    for(int i=0;i<2;++i) {
        auto channel=static_cast<rp_channel_t>(i); uint32_t position=0,count=n; data[i].resize(n);
        if(deep) {
            RP_CHECK(rp_AcqAxiGetWritePointerAtTrig(channel,&position));
            uint32_t start=(position+buffer-pre)%buffer;
            RP_CHECK(rp_AcqAxiGetDataV(channel,start,&count,data[i].data()));
        } else {
            RP_CHECK(rp_AcqGetWritePointerAtTrig(&position));
            RP_CHECK(rp_AcqGetDataV(channel,(position+16384-pre)%16384,&count,data[i].data()));
        }
        if(count!=n) throw std::runtime_error("Short hardware buffer");
    }
    std::ostringstream reply; reply.precision(17); reply<<"OK "<<n<<" "<<125000000.0/dec<<"\n"; text(fd,reply.str());
    for(auto& values:data) exact_write(fd,values.data(),values.size()*sizeof(float));
}
static void client(int fd) {
    timeval tv{125,0}; setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof(tv)); setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&tv,sizeof(tv));
    try {
        std::string line; char c;
        while(line.size()<4096) { exact_read(fd,&c,1); if(c=='\n') break; line+=c; }
        if(line=="STOP") { cancelled=true; text(fd,"OK\n"); }
        else if(line=="PING") text(fd,"OK hann_scope hardware v2\n");
        else { std::istringstream input(line); std::string op; input>>op; if(op!="CAPTURE") throw std::runtime_error("Unknown command"); capture(fd,input); }
    } catch(const std::exception& error) { try { text(fd,std::string("ERROR ")+error.what()+"\n"); } catch(...) {} }
    close(fd);
}
int main(int argc,char** argv) {
    signal(SIGPIPE,SIG_IGN);
    signal(SIGTERM,[](int){quitting=true;cancelled=true;}); signal(SIGINT,[](int){quitting=true;cancelled=true;});
    try {
        RP_CHECK(rp_Init()); off();
        const char* path=argc>1?argv[1]:"/run/hann_scope/hardware.sock";
        int server=socket(AF_UNIX,SOCK_STREAM,0); sockaddr_un address{}; address.sun_family=AF_UNIX;
        if(strlen(path)>=sizeof(address.sun_path)) throw std::runtime_error("Socket path too long");
        strcpy(address.sun_path,path); unlink(path);
        if(bind(server,reinterpret_cast<sockaddr*>(&address),sizeof(address)) || listen(server,8)) throw std::runtime_error("Cannot bind socket");
        chmod(path,0600);
        while(!quitting) {
            fd_set set; FD_ZERO(&set); FD_SET(server,&set); timeval wait{0,200000};
            if(select(server+1,&set,nullptr,nullptr,&wait)>0) { int fd=accept(server,nullptr,nullptr); if(fd>=0) std::thread(client,fd).detach(); }
        }
        cancelled=true; std::lock_guard<std::mutex> lock(hardware_lock); off(); rp_Release(); close(server); unlink(path);
    } catch(const std::exception& e) { std::cerr<<e.what()<<std::endl; return 1; }
}
