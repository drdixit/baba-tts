import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Save,
  Loader2,
  Check,
  AlertCircle,
  RotateCcw,
  Sparkles,
  Radio,
  Tv,
  KeyRound,
} from 'lucide-react';

interface AppSettings {
  azure_speech_key: string;
  azure_speech_region: string;
  azure_speech_voice: string;
  youtube_channel_id: string;
  youtube_live_id: string | null;
  enable_youtube: boolean;
}

interface ApiSettings {
  azureSpeechKey: string;
  azureSpeechRegion: string;
  azureSpeechVoice: string;
  youtubeChannelId: string;
  youtubeLiveId: string | null;
  enableYoutube: boolean;
}

function apiToForm(api: ApiSettings): AppSettings {
  return {
    azure_speech_key: api.azureSpeechKey || '',
    azure_speech_region: api.azureSpeechRegion || 'centralindia',
    azure_speech_voice: api.azureSpeechVoice || '',
    youtube_channel_id: api.youtubeChannelId || '',
    youtube_live_id: api.youtubeLiveId || null,
    enable_youtube: api.enableYoutube ?? true,
  };
}

function formToApi(form: AppSettings): ApiSettings {
  return {
    azureSpeechKey: form.azure_speech_key.trim(),
    azureSpeechRegion: form.azure_speech_region.trim() || 'centralindia',
    azureSpeechVoice: form.azure_speech_voice.trim() || 'hi-IN-MadhurNeural',
    youtubeChannelId: form.youtube_channel_id.trim(),
    youtubeLiveId: form.youtube_live_id?.trim() || null,
    enableYoutube: form.enable_youtube,
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  azure_speech_key: '',
  azure_speech_region: 'centralindia',
  azure_speech_voice: 'hi-IN-MadhurNeural',
  youtube_channel_id: 'UCiz4lqlVpaB4PpK-1aecMgQ',
  youtube_live_id: null,
  enable_youtube: true,
};

const VOICE_PRESETS = [
  { label: 'Madhur (Hindi Male)', value: 'hi-IN-MadhurNeural' },
  { label: 'Swara (Hindi Female)', value: 'hi-IN-SwaraNeural' },
  { label: 'Prabhat (Indian Eng Male)', value: 'en-IN-PrabhatNeural' },
  { label: 'Neerja (Indian Eng Female)', value: 'en-IN-NeerjaNeural' },
];

const REGION_PRESETS = ['centralindia', 'eastus', 'westeurope', 'southeastasia'];

type BannerState = { type: 'success' | 'error'; message: string } | null;

interface SettingsPanelProps {
  onClose?: () => void;
}

export default function SettingsPanel({ onClose: _onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [banner, setBanner] = useState<BannerState>(null);
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ApiSettings) => {
        setSettings(apiToForm(data));
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setBanner({ type: 'error', message: 'Failed to load settings. Is BABA TTS server running?' });
      });
  }, []);

  useEffect(() => {
    if (banner) {
      const timer = setTimeout(() => setBanner(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [banner]);

  const validate = (): boolean => {
    const errors: { [key: string]: string } = {};

    if (settings.enable_youtube && !settings.youtube_channel_id.trim()) {
      errors.youtube_channel_id = 'Channel ID is required when YouTube Live integration is enabled.';
    }

    if (settings.azure_speech_key.trim() && !settings.azure_speech_region.trim()) {
      errors.azure_speech_region = 'Azure region is required when using a Speech Subscription Key.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      setBanner({
        type: 'error',
        message: 'Please resolve the highlighted validation errors before saving.',
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToApi(settings)),
      });

      if (res.ok) {
        setBanner({ type: 'success', message: 'Settings saved successfully! Changes are active immediately.' });
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
      } else {
        const text = await res.text();
        setBanner({ type: 'error', message: `Failed to save: ${text}` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setBanner({ type: 'error', message: `Failed to save settings (${msg}). Check your connection.` });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setSettings(DEFAULT_SETTINGS);
    setFieldErrors({});
    setBanner({ type: 'success', message: 'Reset fields to defaults. Click "Save Settings" to apply.' });
  };

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="h-64 w-full flex flex-col items-center justify-center p-12 gap-3 text-slate-400">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
        <span className="text-xs font-semibold">Loading settings from database...</span>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 text-slate-100">
      {/* Status Banner */}
      {banner && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg transition-all animate-fade-in ${
            banner.type === 'success'
              ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-500/50'
              : 'bg-rose-950/80 text-rose-200 border border-rose-500/50'
          }`}
        >
          {banner.type === 'success' ? (
            <Check className="w-5 h-5 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          )}
          <span>{banner.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* SECTION 1: Azure Speech Service */}
        <section className="bg-slate-900/90 rounded-2xl p-6 border border-slate-800 shadow-md flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-black text-cyan-400 uppercase tracking-widest flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              Azure Speech Service
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase">
              TTS Engine
            </span>
          </div>

          {/* Subscription Key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Speech Subscription Key
              </label>
              <span className="text-[10px] text-slate-500">From Azure AI Portal</span>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.azure_speech_key}
                onChange={(e) => updateField('azure_speech_key', e.target.value)}
                placeholder="Paste your 32-character Azure Speech Key"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono text-sm pr-11 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded-lg"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Required for real-time neural speech synthesis and word-level karaoke synchronization.
            </p>
          </div>

          {/* Region */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Speech Region
              </label>
              <span className="text-[10px] text-slate-500">e.g. centralindia</span>
            </div>
            <input
              type="text"
              value={settings.azure_speech_region}
              onChange={(e) => updateField('azure_speech_region', e.target.value)}
              placeholder="e.g. centralindia, eastus, westeurope"
              className={`w-full px-4 py-2.5 bg-slate-950 border rounded-xl text-white placeholder-slate-500 focus:outline-none font-mono text-sm transition-colors ${
                fieldErrors.azure_speech_region
                  ? 'border-rose-500 focus:border-rose-500'
                  : 'border-slate-700/80 focus:border-cyan-500'
              }`}
            />
            {fieldErrors.azure_speech_region && (
              <p className="text-xs text-rose-400 mt-1 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {fieldErrors.azure_speech_region}
              </p>
            )}
            {/* Quick region tags */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {REGION_PRESETS.map((region) => (
                <button
                  key={region}
                  type="button"
                  onClick={() => updateField('azure_speech_region', region)}
                  className={`text-[10px] px-2 py-0.5 rounded-lg border font-mono transition-colors ${
                    settings.azure_speech_region === region
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {region}
                </button>
              ))}
            </div>
          </div>

          {/* Default Voice */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Default Neural Voice
              </label>
              <span className="text-[10px] text-slate-500">Neural Voice Name</span>
            </div>
            <input
              type="text"
              value={settings.azure_speech_voice}
              onChange={(e) => updateField('azure_speech_voice', e.target.value)}
              placeholder="hi-IN-MadhurNeural"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono text-sm transition-colors"
            />
            {/* Voice presets */}
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              {VOICE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => updateField('azure_speech_voice', preset.value)}
                  className={`text-left text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors flex items-center justify-between ${
                    settings.azure_speech_voice === preset.value
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                      : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{preset.label}</span>
                  {settings.azure_speech_voice === preset.value && (
                    <Check className="w-3 h-3 text-cyan-400 shrink-0 ml-1" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 2: YouTube Live Stream */}
        <section className="bg-slate-900/90 rounded-2xl p-6 border border-slate-800 shadow-md flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-black text-purple-400 uppercase tracking-widest flex items-center gap-2">
              <Tv className="w-4 h-4 text-purple-400" />
              YouTube Live Stream
            </h2>

            {/* Toggle Switch */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">
                {settings.enable_youtube ? 'Active' : 'Disabled'}
              </span>
              <button
                type="button"
                onClick={() => updateField('enable_youtube', !settings.enable_youtube)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                  settings.enable_youtube ? 'bg-purple-600' : 'bg-slate-700'
                }`}
                aria-label="Toggle YouTube live listener"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    settings.enable_youtube ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Channel ID */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                YouTube Channel ID
              </label>
              <span className="text-[10px] text-slate-500">24-char ID (UC...)</span>
            </div>
            <input
              type="text"
              value={settings.youtube_channel_id}
              onChange={(e) => updateField('youtube_channel_id', e.target.value)}
              placeholder="e.g. UCiz4lqlVpaB4PpK-1aecMgQ"
              className={`w-full px-4 py-2.5 bg-slate-950 border rounded-xl text-white placeholder-slate-500 focus:outline-none font-mono text-sm transition-colors ${
                fieldErrors.youtube_channel_id
                  ? 'border-rose-500 focus:border-rose-500'
                  : 'border-slate-700/80 focus:border-purple-500'
              }`}
            />
            {fieldErrors.youtube_channel_id ? (
              <p className="text-xs text-rose-400 mt-1 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3.5 h-3.5" />
                {fieldErrors.youtube_channel_id}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 mt-1">
                BABA automatically detects your active live stream broadcast under this channel ID.
              </p>
            )}
          </div>

          {/* Live ID Override */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Live Video ID Override
              </label>
              <span className="text-[10px] text-slate-500 font-mono">Optional</span>
            </div>
            <input
              type="text"
              value={settings.youtube_live_id ?? ''}
              onChange={(e) => updateField('youtube_live_id', e.target.value || null)}
              placeholder="e.g. jfKfPfyJRdk (leave empty for auto-detect)"
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono text-sm transition-colors"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Specify this only if you want to lock BABA TTS to a specific broadcast or scheduled stream URL.
            </p>
          </div>

          {/* Live status badge */}
          <div className="mt-auto p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center gap-2.5 text-xs text-slate-400">
            <Radio className={`w-4 h-4 ${settings.enable_youtube ? 'text-purple-400 animate-pulse' : 'text-slate-600'}`} />
            <div>
              <span className="font-semibold text-slate-300">
                {settings.enable_youtube ? 'Live Listener Enabled' : 'Live Listener Inactive'}
              </span>
              <span className="block text-[11px] text-slate-500">
                {settings.enable_youtube
                  ? 'Chat messages will be received and voiced automatically.'
                  : 'Enable this when starting your live broadcast.'}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Save Settings Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>
            Persisted in SQLite (<span className="font-mono text-cyan-300">baba.db</span>). Applies live instantly without server restart.
          </span>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 transition-colors"
            title="Reset form fields to default values"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg ${
              justSaved
                ? 'bg-emerald-600 text-white'
                : 'bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white shadow-cyan-950/40'
            }`}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : justSaved ? (
              <>
                <Check className="w-4 h-4 text-emerald-200" />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Save Settings</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
