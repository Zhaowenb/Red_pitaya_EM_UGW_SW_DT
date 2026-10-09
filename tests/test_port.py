import copy
import importlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import numpy as np

PROJECT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(PROJECT/'app'))
sys.path.insert(0,str(PROJECT.parent/'Pico_4824A'))
HAS_PICO = importlib.util.find_spec('pico4824a') is not None
from redscope.hardware_config import defaults,validate_hardware,output_config
from redscope.config import AcquisitionConfig
from redscope.device import RedPitaya
from redscope.storage import save_npz,load_npz
from redscope.sweep import SweepConfig,execute_sweep,aggregate_rows
from redscope.analysis import load_dataset,process_dataset,reevaluate_sweep_directory

class PortTests(unittest.TestCase):
    def test_default_deep_record_and_roles(self):
        cfg=defaults(); self.assertEqual(validate_hardware(cfg),25)
        self.assertEqual(cfg.total_samples,50000)
        with RedPitaya(simulate=True) as device:
            result=device.capture(cfg)
            self.assertEqual(len(device.last_captures),2)
            self.assertEqual([r.config.redpitaya['excitation_id'] for r in device.last_captures],['OUT1','OUT2'])
            self.assertEqual(set(result.volts),{'A','B'})
            self.assertEqual(result.samples,50000)
            self.assertAlmostEqual(result.time_s[5000],0)
            self.assertTrue(result.simulated)

    def test_hardware_rejects_impossible_settings(self):
        for modify in [lambda c:setattr(c,'sample_rate_hz',6_000_000),
                       lambda c:setattr(c.channels['H'],'enabled',True),
                       lambda c:setattr(c.channels['A'],'coupling','AC'),
                       lambda c:setattr(c.awg,'pk_to_pk_v',4),
                       lambda c:setattr(c,'post_trigger_samples',2_000_001)]:
            cfg=defaults(); modify(cfg)
            with self.assertRaises(ValueError):validate_hardware(cfg)

    def test_monitor_and_simultaneous(self):
        cfg=defaults();cfg.redpitaya['mode']='simultaneous';cfg.redpitaya['roles']['A']='monitor'
        with RedPitaya(simulate=True) as device:
            result=device.capture(cfg)
            self.assertEqual(len(device.last_captures),1)
            self.assertEqual(result.config.redpitaya['excitation_id'],'OUT1+OUT2')
            self.assertGreater(max(abs(result.volts['A'])),max(abs(result.volts['B'])))

    @unittest.skipUnless(HAS_PICO, '可选 Pico 原实现未提供')
    def test_waveforms_identical_to_pico(self):
        import pico4824a.waveforms as original
        import redscope.waveforms as port
        cfg=defaults().awg
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'custom.csv';np.savetxt(path,np.sin(np.linspace(0,6.28,100)),delimiter=',')
            cfg.custom_csv=str(path)
            for waveform in ('sine','square','triangle','hann_burst','hann_cancel','hann_ramp_hold','custom'):
                cfg.waveform=waveform
                a,fa=original.normalized_waveform(cfg); b,fb=port.normalized_waveform(cfg)
                np.testing.assert_array_equal(a,b);self.assertEqual(fa,fb)

    @unittest.skipUnless(HAS_PICO, '可选 Pico 原实现未提供')
    def test_time_frequency_parity(self):
        from pico4824a.time_frequency import time_frequency_map as original
        from redscope.time_frequency import time_frequency_map as port
        t=np.arange(4000)/2e6; values=np.sin(2*np.pi*73700*t)
        for method in ('stft','wpd','cwt'):
            options={'method':method,'frequency_min_hz':20000,'frequency_max_hz':180000}
            a,b=original(t,values,options),port(t,values,options)
            np.testing.assert_allclose(a['values_db'],b['values_db'],atol=1e-10)
            self.assertEqual(a['details'],b['details'])

    @unittest.skipUnless(HAS_PICO, '可选 Pico 原实现未提供')
    def test_fft_and_legacy_eight_channel_import(self):
        from pico4824a.analysis import process_dataset as original
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'legacy.npz';t=np.arange(-400,3600)/2e6
            np.savez(file,time_s=t,metadata_json=json.dumps({'actual_sample_rate_hz':2e6}),**{f'ch_{n}_v':np.sin(2*np.pi*73700*t)*(i+1)/8 for i,n in enumerate('ABCDEFGH')})
            self.assertEqual(len(load_dataset(file)[1]),8)
            raw={'channels':['A','H'],'filter':{'enabled':True,'low_hz':20000,'high_hz':180000,'transition_hz':5000}}
            a,b=original(file,raw),process_dataset(file,raw)
            self.assertEqual(a,b)

    def test_round_trip_new_capture(self):
        with tempfile.TemporaryDirectory() as folder,RedPitaya(simulate=True) as device:
            result=device.capture(defaults()); path=save_npz(result,Path(folder)/'test.npz')
            read=load_npz(path)
            self.assertEqual(read.config.redpitaya,result.config.redpitaya)
            np.testing.assert_array_equal(read.volts['B'],result.volts['B'])

    @unittest.skipUnless(HAS_PICO, '可选 Pico 原实现未提供')
    def test_symmetry_and_nf_metrics_parity(self):
        from pico4824a.experimental_modes import experimental_mode_analysis as original
        from redscope.experimental_modes import experimental_mode_analysis as port
        from pico4824a.sweep import capture_metrics as original_metrics
        from redscope.sweep import capture_metrics
        with RedPitaya(simulate=True) as device:
            result=device.capture(defaults())
            raw={'reference_channel':'A','comparison_channel':'B'}
            a=original(result.time_s,result.volts['A'],result.volts['B'],raw)
            b=port(result.time_s,result.volts['A'],result.volts['B'],raw)
            self.assertEqual(a,b)
            sweep=SweepConfig.from_dict({'receiver_channels':['A','B'],'transmitter_channel':'NONE'})
            self.assertEqual(original_metrics(result,sweep),capture_metrics(result,sweep))

    @unittest.skipUnless(HAS_PICO, '可选 Pico 原实现未提供')
    def test_stft_large_grid_parity(self):
        from pico4824a.time_frequency import time_frequency_map as original
        from redscope.time_frequency import time_frequency_map as port
        t=np.arange(50000)/5e6; v=np.sin(2*np.pi*73700*t)
        options={'method':'stft','fft_samples':4096,'window_us':20,'overlap_ratio':.9}
        a,b=original(t,v,options),port(t,v,options)
        np.testing.assert_allclose(a['values_db'],b['values_db'],atol=1e-10)
        self.assertEqual(a['time_us'],b['time_us'])

    def test_internal_trigger_with_in1_disabled(self):
        cfg=defaults(); cfg.channels['A'].enabled=False; cfg.redpitaya['roles']['A']='disabled'
        self.assertEqual(validate_hardware(cfg),25)

    @unittest.skipUnless(HAS_PICO, '可选 Pico 原实现未提供')
    def test_real_pico_history_parity(self):
        from pico4824a.analysis import process_dataset as original
        from pico4824a.time_frequency import time_frequency_map as old_tf
        from redscope.time_frequency import time_frequency_map as new_tf
        for name in ('capture_20260723_154019.npz','capture_20260723_154838.npz'):
            path=PROJECT.parent/'Pico_4824A'/'data'/name
            if not path.exists(): self.skipTest('历史文件未提供')
            t,channels,_=load_dataset(path)
            options={'channels':list(channels),'filter':{'enabled':True,'low_hz':60000,'high_hz':90000,'transition_hz':5000}}
            self.assertEqual(original(path,options),process_dataset(path,options))
            for method in ('stft','wpd','cwt'):
                raw={'method':method,'start_us':0,'end_us':900,'frequency_min_hz':20000,'frequency_max_hz':180000}
                a,b=old_tf(t,next(iter(channels.values())),raw),new_tf(t,next(iter(channels.values())),raw)
                np.testing.assert_allclose(a['values_db'],b['values_db'],atol=1e-10)

    def test_four_path_sweep_and_reevaluation(self):
        cfg=defaults()
        sweep=SweepConfig.from_dict({'mode':'frequency','frequency_start_hz':70000,'frequency_stop_hz':80000,'frequency_step_hz':10000,
                                     'repeats':2,'interval_s':0,'receiver_channels':['A','B'],'transmitter_channel':'NONE'})
        with tempfile.TemporaryDirectory() as folder,RedPitaya(simulate=True) as device:
            outcome=execute_sweep(cfg,sweep,device,Path(folder),threading.Event())
            self.assertEqual(len(outcome.run_rows),8)
            self.assertEqual(len(outcome.summary_rows),4)
            self.assertTrue(all(r['repeats_completed']==2 for r in outcome.summary_rows))
            revised=reevaluate_sweep_directory(outcome.directory,{})
            self.assertEqual(len(revised['summary']),4)
            self.assertEqual({r['excitation_id'] for r in revised['runs']},{'OUT1','OUT2'})

    def test_analysis_worker(self):
        from redscope.server import Jobs
        import redscope.server as server
        import time
        old=server.ROOT
        with tempfile.TemporaryDirectory() as folder,RedPitaya(simulate=True) as device:
            server.ROOT=Path(folder)
            file=save_npz(device.capture(defaults()),Path(folder)/'capture.npz')
            jobs=Jobs();task=jobs.start('/api/analysis/process',{'path':str(file),'channels':['A','B']})
            deadline=time.monotonic()+20
            while time.monotonic()<deadline:
                result=jobs.get(task)
                if result['state']!='running':break
                time.sleep(.1)
            jobs.cancel();self.assertEqual(result['state'],'complete',result)
        server.ROOT=old

    def test_stopped_sweep_retains_completed_record(self):
        stop=threading.Event()
        def progress(state,result):
            if state['phase']=='saved': stop.set()
        sweep=SweepConfig.from_dict({'receiver_channels':['A','B'],'transmitter_channel':'NONE','interval_s':0})
        with tempfile.TemporaryDirectory() as folder,RedPitaya(simulate=True) as device:
            result=execute_sweep(defaults(),sweep,device,Path(folder),stop,progress)
            self.assertTrue(result.stopped); self.assertEqual(len(result.run_rows),1)
            self.assertTrue((result.directory/result.run_rows[0]['npz_file']).is_file())
            self.assertTrue((result.directory/'runs.csv').is_file())
            self.assertTrue((result.directory/'summary.csv').is_file())

if __name__=='__main__':unittest.main()
