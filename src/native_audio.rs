use std::time::Duration;

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
    use std::io::Cursor;
    use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
    use std::thread;
    use tracing::{error, info};

    enum AudioCmd {
        Play {
            message_id: String,
            bytes: Vec<u8>,
            on_finished: Box<dyn FnOnce(String) + Send + 'static>,
        },
        Stop,
        #[allow(dead_code)]
        SetVolume(f32),
        #[allow(dead_code)]
        ToggleMute,
        #[allow(dead_code)]
        SetMute(bool),
    }

    #[derive(Clone)]
    pub struct NativeAudioPlayer {
        cmd_tx: Sender<AudioCmd>,
    }

    impl NativeAudioPlayer {
        pub fn new() -> Self {
            let (cmd_tx, cmd_rx) = channel::<AudioCmd>();

            thread::Builder::new()
                .name("baba-audio-worker".into())
                .spawn(move || {
                    audio_worker_loop(cmd_rx);
                })
                .expect("Failed to spawn native audio worker thread");

            Self { cmd_tx }
        }

        pub fn play(
            &self,
            message_id: String,
            bytes: Vec<u8>,
            on_finished: impl FnOnce(String) + Send + 'static,
        ) {
            let _ = self.cmd_tx.send(AudioCmd::Play {
                message_id,
                bytes,
                on_finished: Box::new(on_finished),
            });
        }

        pub fn stop(&self) {
            let _ = self.cmd_tx.send(AudioCmd::Stop);
        }

        pub fn set_volume(&self, vol: f32) {
            let _ = self.cmd_tx.send(AudioCmd::SetVolume(vol));
        }

        #[allow(dead_code)]
        pub fn toggle_mute(&self) {
            let _ = self.cmd_tx.send(AudioCmd::ToggleMute);
        }

        #[allow(dead_code)]
        pub fn set_mute(&self, muted: bool) {
            let _ = self.cmd_tx.send(AudioCmd::SetMute(muted));
        }
    }

    fn audio_worker_loop(cmd_rx: Receiver<AudioCmd>) {
        // Initialize WASAPI output stream on this dedicated worker thread
        let (_stream, stream_handle) = match OutputStream::try_default() {
            Ok(res) => res,
            Err(e) => {
                error!("[NativeAudio] Failed to initialize default WASAPI audio output: {}. Native playback will be disabled.", e);
                // Drain requests and call on_finished immediately so queue doesn't stall
                while let Ok(cmd) = cmd_rx.recv() {
                    if let AudioCmd::Play { message_id, on_finished, .. } = cmd {
                        on_finished(message_id);
                    }
                }
                return;
            }
        };

        info!("[NativeAudio] Initialized WASAPI audio output stream successfully on worker thread");

        let mut current_sink: Option<Sink> = None;
        let mut active_msg: Option<(String, Box<dyn FnOnce(String) + Send + 'static>)> = None;
        let mut master_volume: f32 = 1.0;
        let mut is_muted: bool = false;

        let calc_effective_volume = |vol: f32, muted: bool| -> f32 {
            if muted {
                0.0
            } else {
                vol.clamp(0.0, 1.0)
            }
        };

        loop {
            // Check if we have an active sink currently playing
            let is_playing = current_sink.as_ref().map(|s| !s.empty()).unwrap_or(false);

            if !is_playing {
                if let Some((msg_id, on_finished)) = active_msg.take() {
                    info!("[NativeAudio] Playback completed for message {}", msg_id);
                    on_finished(msg_id);
                }
                current_sink = None;

                // Blocking wait for next command when idle
                match cmd_rx.recv() {
                    Ok(AudioCmd::Play { message_id, bytes, on_finished }) => {
                        let eff_vol = calc_effective_volume(master_volume, is_muted);
                        start_playback(&stream_handle, message_id, bytes, eff_vol, on_finished, &mut current_sink, &mut active_msg);
                    }
                    Ok(AudioCmd::Stop) => {
                        // Already idle
                    }
                    Ok(AudioCmd::SetVolume(vol)) => {
                        master_volume = vol.clamp(0.0, 1.0);
                        if is_muted && master_volume > 0.0 {
                            is_muted = false;
                        }
                        info!("[NativeAudio] Master volume set to {:.2} (idle, muted={})", master_volume, is_muted);
                    }
                    Ok(AudioCmd::ToggleMute) => {
                        is_muted = !is_muted;
                        info!("[NativeAudio] Mute toggled (idle): muted={}", is_muted);
                    }
                    Ok(AudioCmd::SetMute(muted)) => {
                        is_muted = muted;
                        info!("[NativeAudio] Mute set (idle): muted={}", is_muted);
                    }
                    Err(_) => {
                        // Channel closed (app shutdown)
                        break;
                    }
                }
            } else {
                // Currently playing: poll for commands with a brief sleep to allow playback to progress
                match cmd_rx.try_recv() {
                    Ok(AudioCmd::Play { message_id, bytes, on_finished }) => {
                        // Stop previous audio and start new one
                        if let Some(sink) = current_sink.take() {
                            sink.stop();
                        }
                        if let Some((old_id, old_cb)) = active_msg.take() {
                            info!("[NativeAudio] Preempted playback for message {}", old_id);
                            old_cb(old_id);
                        }
                        let eff_vol = calc_effective_volume(master_volume, is_muted);
                        start_playback(&stream_handle, message_id, bytes, eff_vol, on_finished, &mut current_sink, &mut active_msg);
                    }
                    Ok(AudioCmd::Stop) => {
                        if let Some(sink) = current_sink.take() {
                            sink.stop();
                        }
                        if let Some((old_id, old_cb)) = active_msg.take() {
                            info!("[NativeAudio] Stopped playback for message {}", old_id);
                            old_cb(old_id);
                        }
                    }
                    Ok(AudioCmd::SetVolume(vol)) => {
                        master_volume = vol.clamp(0.0, 1.0);
                        if is_muted && master_volume > 0.0 {
                            is_muted = false;
                        }
                        let eff_vol = calc_effective_volume(master_volume, is_muted);
                        if let Some(sink) = &current_sink {
                            sink.set_volume(eff_vol);
                        }
                        info!("[NativeAudio] Real-time master volume set to {:.2} (effective={:.2}, muted={})", master_volume, eff_vol, is_muted);
                    }
                    Ok(AudioCmd::ToggleMute) => {
                        is_muted = !is_muted;
                        let eff_vol = calc_effective_volume(master_volume, is_muted);
                        if let Some(sink) = &current_sink {
                            sink.set_volume(eff_vol);
                        }
                        info!("[NativeAudio] Real-time mute toggled: muted={} (effective={:.2})", is_muted, eff_vol);
                    }
                    Ok(AudioCmd::SetMute(muted)) => {
                        is_muted = muted;
                        let eff_vol = calc_effective_volume(master_volume, is_muted);
                        if let Some(sink) = &current_sink {
                            sink.set_volume(eff_vol);
                        }
                        info!("[NativeAudio] Real-time mute set: muted={} (effective={:.2})", is_muted, eff_vol);
                    }
                    Err(TryRecvError::Empty) => {
                        thread::sleep(Duration::from_millis(15));
                    }
                    Err(TryRecvError::Disconnected) => {
                        if let Some(sink) = current_sink.take() {
                            sink.stop();
                        }
                        break;
                    }
                }
            }
        }
    }

    fn start_playback(
        stream_handle: &OutputStreamHandle,
        message_id: String,
        bytes: Vec<u8>,
        volume: f32,
        on_finished: Box<dyn FnOnce(String) + Send + 'static>,
        current_sink: &mut Option<Sink>,
        active_msg: &mut Option<(String, Box<dyn FnOnce(String) + Send + 'static>)>,
    ) {
        let cursor = Cursor::new(bytes);
        match Decoder::new(cursor) {
            Ok(source) => {
                match Sink::try_new(stream_handle) {
                    Ok(sink) => {
                        info!("[NativeAudio] Starting native playback for message {} at volume {:.2}", message_id, volume);
                        sink.set_volume(volume);
                        sink.append(source);
                        sink.play();
                        *current_sink = Some(sink);
                        *active_msg = Some((message_id, on_finished));
                    }
                    Err(e) => {
                        error!("[NativeAudio] Failed to create Sink: {}", e);
                        on_finished(message_id);
                    }
                }
            }
            Err(e) => {
                error!("[NativeAudio] Failed to decode audio bytes for {}: {}", message_id, e);
                on_finished(message_id);
            }
        }
    }
}

#[cfg(not(windows))]
mod non_windows_impl {
    use super::*;
    use std::sync::mpsc::{channel, Sender};
    use std::thread;

    enum AudioCmd {
        Play {
            message_id: String,
            duration: Duration,
            on_finished: Box<dyn FnOnce(String) + Send + 'static>,
        },
        Stop,
        #[allow(dead_code)]
        SetVolume(f32),
        #[allow(dead_code)]
        ToggleMute,
        #[allow(dead_code)]
        SetMute(bool),
    }

    #[derive(Clone)]
    pub struct NativeAudioPlayer {
        cmd_tx: Sender<AudioCmd>,
    }

    impl NativeAudioPlayer {
        pub fn new() -> Self {
            let (cmd_tx, cmd_rx) = channel::<AudioCmd>();

            thread::Builder::new()
                .name("baba-audio-sim".into())
                .spawn(move || {
                    while let Ok(cmd) = cmd_rx.recv() {
                        match cmd {
                            AudioCmd::Play { message_id, duration, on_finished } => {
                                let mut active_stop = false;
                                let step = Duration::from_millis(50);
                                let mut elapsed = Duration::ZERO;
                                while elapsed < duration {
                                    thread::sleep(step.min(duration - elapsed));
                                    elapsed += step;
                                    if let Ok(AudioCmd::Stop) = cmd_rx.try_recv() {
                                        active_stop = true;
                                        break;
                                    }
                                }
                                if !active_stop {
                                    on_finished(message_id);
                                }
                            }
                            AudioCmd::Stop => {}
                            AudioCmd::SetVolume(_) => {}
                            AudioCmd::ToggleMute => {}
                            AudioCmd::SetMute(_) => {}
                        }
                    }
                })
                .expect("Failed to spawn sim audio worker thread");

            Self { cmd_tx }
        }

        pub fn play(
            &self,
            message_id: String,
            _bytes: Vec<u8>,
            on_finished: impl FnOnce(String) + Send + 'static,
        ) {
            let _ = self.cmd_tx.send(AudioCmd::Play {
                message_id,
                duration: Duration::from_millis(200),
                on_finished: Box::new(on_finished),
            });
        }

        pub fn stop(&self) {
            let _ = self.cmd_tx.send(AudioCmd::Stop);
        }

        pub fn set_volume(&self, vol: f32) {
            let _ = self.cmd_tx.send(AudioCmd::SetVolume(vol));
        }

        #[allow(dead_code)]
        pub fn toggle_mute(&self) {
            let _ = self.cmd_tx.send(AudioCmd::ToggleMute);
        }

        #[allow(dead_code)]
        pub fn set_mute(&self, muted: bool) {
            let _ = self.cmd_tx.send(AudioCmd::SetMute(muted));
        }
    }
}

#[cfg(windows)]
pub use windows_impl::NativeAudioPlayer;

#[cfg(not(windows))]
pub use non_windows_impl::NativeAudioPlayer;
