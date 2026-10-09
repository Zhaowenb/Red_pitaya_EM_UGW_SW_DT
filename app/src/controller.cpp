// Bazaar owns the application lifetime; the daemon alone owns the FPGA/API.
#include "main.h"
#include <sys/wait.h>
#include <unistd.h>
static int service(const char* action) {
    pid_t pid=fork();
    if(pid<0) return -1;
    if(pid==0) { execl("/bin/systemctl","systemctl",action,"hann-scope.target",static_cast<char*>(nullptr)); _exit(127); }
    int status=0; if(waitpid(pid,&status,0)<0) return -1;
    return WIFEXITED(status)&&WEXITSTATUS(status)==0?0:-1;
}
const char* rp_app_desc(void) { return "Hann Burst Scope v2: acquisition, sweeps and offline analysis"; }
int rp_app_init(void) { return service("start"); }
int rp_app_exit(void) { return service("stop"); }
int rp_set_params(rp_app_params_t*,int) { return 0; }
int rp_get_params(rp_app_params_t**) { return 0; }
int rp_get_signals(float***,int*,int*) { return 0; }
void UpdateSignals() {} void UpdateParams() {} void OnNewParams() {} void OnNewSignals() {} void PostUpdateSignals() {}
