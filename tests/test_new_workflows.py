"""Board-aware API integration tests. Every acquisition is explicitly simulated."""
import copy
import json
from pathlib import Path
import time
import unittest
import test_http
from redscope.hardware_config import defaults


class NewWorkflowTests(unittest.TestCase):
    setUp=test_http.HttpTests.setUp
    tearDown=test_http.HttpTests.tearDown
    request=test_http.HttpTests.request
    def config(self):
        cfg=defaults().to_dict()
        cfg['simulate']=True
        cfg['redpitaya'].update(mode='out1', roles={'A':'monitor','B':'monitor'})
        return cfg

    def finish(self):
        for _ in range(300):
            state=self.http.control.snapshot()
            if state['state'] not in ('running','paused'): break
            time.sleep(.01)
        self.assertEqual(state['state'],'complete',state)

    def job(self,path,payload):
        code,body=self.request(path,payload)
        self.assertEqual(code,202,body)
        job_id=json.loads(body)['job_id']
        for _ in range(300):
            reply=json.loads(self.request('/api/jobs?id='+job_id)[1])
            if reply['state']!='running': break
            time.sleep(.02)
        self.assertEqual(reply['state'],'complete',reply)
        return reply['result']

    def test_lcr_calibration_capture_filter_and_archive(self):
        payload={'config':self.config(),'lcr':{'repeats':1,'interval_s':0,'frequency_hz':73700,
                    'excitation_vpp':.1},'standard_resistance_ohm':100}
        code,body=self.request('/api/lcr/calibrate',payload)
        self.assertEqual(code,202,body); self.finish()
        outcome=json.loads(self.request('/api/lcr/result')[1])
        self.assertTrue(Path(outcome['calibration_file']).is_file())
        payload['lcr'].update(calibration_enabled=True,calibration_file=outcome['calibration_file'])
        code,body=self.request('/api/lcr/start',payload)
        self.assertEqual(code,202,body); self.finish()
        result=json.loads(self.request('/api/lcr/result')[1])
        self.assertAlmostEqual(result['run_rows'][0]['impedance_magnitude_ohm'],100,places=6)
        raw=self.http.control.result.volts['A'].copy()
        code,body=self.request('/api/result/display',{'filter':{'enabled':True,'low_hz':20000,'high_hz':180000}})
        self.assertEqual(code,200,body)
        self.assertTrue((raw==self.http.control.result.volts['A']).all())
        folder=Path(result['directory']); original=(folder/'runs.csv').read_bytes()
        archive=self.job('/api/lcr-analysis/load',{'mode':'small_lcr','directory':str(folder),'reanalyze':True})
        self.assertEqual(archive['total_runs'],1)
        self.assertEqual(original,(folder/'runs.csv').read_bytes())
        self.assertTrue(Path(archive['report_path']).is_file())
        payload['config']['simulate']=False
        code,body=self.request('/api/lcr/start',payload)
        self.assertEqual(code,400,body)
        self.assertIn('不能混用',json.loads(body)['error'])

    def test_big_lcr_grid_and_two_monitor_distortion(self):
        payload={'config':self.config(),'safety_acknowledged':True,'big_lcr':{
            'mode':'linear','scan_mode':'grid','frequency_start_hz':70000,'frequency_stop_hz':80000,
            'frequency_step_hz':10000,'awg_vpp_start':.1,'awg_vpp_stop':.2,'awg_vpp_step':.1,
            'auto_monitor_range':False,'ata_voltage_gain':10,'repeats':1,'interval_s':0}}
        code,body=self.request('/api/big-lcr/start',payload)
        self.assertEqual(code,202,body); self.finish()
        result=json.loads(self.request('/api/big-lcr/result')[1])
        self.assertEqual(len(result['run_rows']),4)
        archive=self.job('/api/lcr-analysis/load',{'mode':'big_lcr','directory':result['directory'],'reanalyze':True})
        self.assertEqual(archive['total_runs'],4)
        distortion=self.job('/api/big-lcr/linearity',{'directory':result['directory'],'harmonic_order':3})
        self.assertTrue(distortion)

    def test_stale_excitation_selection_does_not_replace_task_result(self):
        from redscope.device import RedPitaya
        from redscope.config import AcquisitionConfig
        with RedPitaya(simulate=True) as device:
            captured=device.capture(AcquisitionConfig.from_dict(self.config()))
        self.http.control.captures=[captured]
        self.http.control.result=None
        for kind, state in [('lcr','complete'),('big_lcr','running'),('capture','running'),('capture','paused')]:
            self.http.control.status.task_kind=kind
            self.http.control.status.state=state
            code,body=self.request('/api/result?excitation=OUT1')
            self.assertEqual(code,400,body)
            self.assertIsNone(self.http.control.result)
        self.http.control.status.task_kind='capture'
        self.http.control.status.state='complete'
        self.assertEqual(self.request('/api/result?excitation=OUT1')[0],200)
        self.assertIs(self.http.control.result,captured)

    def test_new_tasks_fail_before_hardware_for_unsupported_settings(self):
        payload={'config':self.config(),'lcr':{'repeats':1}}
        payload['config']['sample_rate_hz']=3e6
        self.assertEqual(self.request('/api/lcr/start',payload)[0],400)
        payload['config']=self.config();payload['config']['redpitaya']['mode']='alternating'
        self.assertEqual(self.request('/api/lcr/start',payload)[0],400)
        payload={'config':self.config(),'safety_acknowledged':True,'big_lcr':{'auto_monitor_range':True,'ata_voltage_gain':10}}
        self.assertEqual(self.request('/api/big-lcr/start',payload)[0],400)
        self.assertEqual(self.request('/api/lcr-linearity/start',{})[0],400)
        self.assertEqual(self.http.control.status.state,'idle')

    def test_lcr_output_change_invalidates_calibration(self):
        from redscope.lcr import LcrConfig, _calibration_signature, _signature_mismatches
        from redscope.config import AcquisitionConfig
        cfg=AcquisitionConfig.from_dict(self.config()); m=LcrConfig()
        signature=_calibration_signature(cfg,m)
        cfg.redpitaya['mode']='out2'
        self.assertIn('redpitaya_output',_signature_mismatches(_calibration_signature(cfg,m),signature))

    def test_overflow_cannot_be_used_for_small_lcr(self):
        from redscope.lcr import LcrConfig, analyze_impedance
        from redscope.device import RedPitaya
        from redscope.config import AcquisitionConfig
        with RedPitaya(simulate=True) as device:
            capture=device.capture(AcquisitionConfig.from_dict(self.config()))
        capture.overflow_channels=('A',)
        with self.assertRaisesRegex(ValueError,'溢出'):
            analyze_impedance(capture,LcrConfig(),100000)

    def test_stop_lcr_preserves_completed_runs(self):
        payload={'config':self.config(),'lcr':{'repeats':10,'interval_s':.2,'excitation_vpp':.1}}
        self.assertEqual(self.request('/api/lcr/start',payload)[0],202)
        for _ in range(100):
            if list(self.root.glob('lcr/*/raw/*.npz')): break
            time.sleep(.01)
        self.assertEqual(self.request('/api/stop',{})[0],200)
        for _ in range(100):
            if self.http.control.status.state=='stopped': break
            time.sleep(.01)
        self.assertEqual(self.http.control.status.state,'stopped')
        result=self.http.control.lcr_result_payload()
        self.assertGreaterEqual(len(result['run_rows']),1)
        self.assertLess(len(result['run_rows']),10)
        self.assertTrue((Path(result['directory'])/'runs.csv').exists())

    def test_pause_is_exclusive_and_stoppable(self):
        self.http.control.status.state='paused'
        self.http.control._trip_alarm={'alarm_id':'test'}
        self.assertEqual(self.request('/api/lcr/start',{'config':self.config(),'lcr':{}})[0],400)
        self.assertEqual(self.request('/api/stop',{})[0],200)
        self.assertTrue(self.http.control._stop_event.is_set())

    def test_interference_import_uses_copy_and_rejects_escape(self):
        from redscope import interference
        from redscope.config import AcquisitionConfig
        folder=self.root/'uploads'/'legacy'; folder.mkdir(parents=True)
        legacy=AcquisitionConfig();legacy.awg.frequency_hz=75000
        original=interference.create_session({'config':legacy.to_dict(),
            'channels':{'rx':'A','rod':'B','trigger':'C','rx_probe':1,'rod_probe':1},
            'windows_us':{'t0':0,'baseline_start':-50,'baseline_end':-5,'tail_end':200},'repeats':3},folder)
        source=folder/original['id']; before=(source/'session.json').read_bytes()
        code,body=self.request('/api/interference/import',{'directory':str(source)})
        self.assertEqual(code,200,body)
        self.assertNotEqual(json.loads(body)['session']['id'],original['id'])
        self.assertEqual(before,(source/'session.json').read_bytes())
        original['runs']=[{'raw_file':'../outside.npz','fft_file':'../outside.npz'}]
        (source/'session.json').write_text(json.dumps(original),encoding='utf-8')
        self.assertEqual(self.request('/api/interference/import',{'directory':str(source)})[0],400)
