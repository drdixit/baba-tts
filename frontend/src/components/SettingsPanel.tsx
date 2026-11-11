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

const REGION_PRESETS = [
  'centralindia',
  'eastus',
  'eastus2',
  'westus',
  'westus2',
  'westeurope',
  'northeurope',
  'southeastasia',
];

const VOICE_PRESETS = [
  { value: 'hi-IN-MadhurNeural', label: 'Madhur (Hindi - Male - Expressive)' },
  { value: 'hi-IN-SwaraNeural', label: 'Swara (Hindi - Female - Warm)' },
  { value: 'en-IN-PrabhatNeural', label: 'Prabhat (Indian English - Male)' },
  { value: 'en-IN-NeerjaNeural', label: 'Neerja (Indian English - Female)' },
];

export default function SettingsPanel() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchSettings() {
      try {
        setLoading(true);
        const res = await fetch('/api/settings');
        if (!res.ok) {
          throw new Error(`Failed to load settings: ${res.statusText}`);
        }
        const data = await res.json();
        if (!cancelled) {
          setSettings(apiToForm(data));
        }
      } catch (err: any) {
        if (!cancelled) {
          setBanner({
            type: 'error',
            message: err.message || 'Error connecting to settings service',
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (field: keyof AppSettings, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!settings.azure_speech_region.trim()) {
      errors.azure_speech_region = 'Azure region is required (e.g. centralindia)';
    }
    if (settings.enable_youtube && !settings.youtube_channel_id.trim()) {
      errors.youtube_channel_id = 'Channel ID is required when YouTube live stream is enabled';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      setBanner({
        type: 'error',
        message: 'Please review and fix validation errors before saving.',
      });
      return;
    }

    try {
      setSaving(true);
      setBanner(null);

      const payload = formToApi(settings);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `Save failed with HTTP ${res.status}`);
      }

      setBanner({
        type: 'success',
        message: 'Settings saved successfully! TTS Engine and YouTube listener updated live.',
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err: any) {
      setBanner({
        type: 'error',
        message: err.message || 'Failed to persist settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (window.confirm('Reset all settings to default values?')) {
      setSettings(DEFAULT_SETTINGS);
      setFieldErrors({});
      setBanner({
        type: 'success',
        message: 'Reset form to defaults. Click "Save Settings" to persist.',
      });
    }
  };

  if (loading) {
    return (
      <div className="w-full h-72 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
        <span className="text-xs font-semibold">Loading settings from database...</span>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 text-slate-800">
      {/* Status Banner */}
      {banner && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold shadow-xs transition-all animate-fade-in ${
            banner.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {banner.type === 'success' ? (
            <Check className="w-5 h-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
          )}
          <span>{banner.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* SECTION 1: Azure Speech Service */}
        <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-xs font-black text-indigo-700 uppercase tracking-widest flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-600" />
              Azure Speech Service
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
              TTS Engine
            </span>
          </div>

          {/* Subscription Key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Speech Subscription Key
              </label>
              <span className="text-[10px] text-slate-400">From Azure AI Portal</span>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.azure_speech_key}
                onChange={(e) => updateField('azure_speech_key', e.target.value)}
                placeholder="Paste your 32-character Azure Speech Key"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 font-mono text-sm pr-11 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-lg"
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
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Speech Region
              </label>
              <span className="text-[10px] text-slate-400">e.g. centralindia</span>
            </div>
            <input
              type="text"
              value={settings.azure_speech_region}
              onChange={(e) => updateField('azure_speech_region', e.target.value)}
              placeholder="e.g. centralindia, eastus, westeurope"
              className={`w-full px-4 py-2.5 bg-slate-50 border rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white font-mono text-sm transition-colors ${
                fieldErrors.azure_speech_region
                  ? 'border-rose-500 focus:border-rose-500'
                  : 'border-slate-300 focus:border-indigo-600'
              }`}
            />
            {fieldErrors.azure_speech_region && (
              <p className="text-xs text-rose-600 mt-1 flex items-center gap-1 font-medium">
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
                      ? 'bg-indigo-100 text-indigo-800 border-indigo-300 font-bold'
                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
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
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Default Neural Voice
              </label>
              <span className="text-[10px] text-slate-400">Neural Voice Name</span>
            </div>
            <input
              type="text"
              value={settings.azure_speech_voice}
              onChange={(e) => updateField('azure_speech_voice', e.target.value)}
              placeholder="hi-IN-MadhurNeural"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 font-mono text-sm transition-colors"
            />
            {/* Voice presets */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2">
              {VOICE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => updateField('azure_speech_voice', preset.value)}
                  className={`text-left text-[11px] px-2.5 py-1.5 rounded-lg border transition-colors flex items-center justify-between ${
                    settings.azure_speech_voice === preset.value
                      ? 'bg-indigo-100 text-indigo-900 border-indigo-300 font-bold shadow-xs'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className="truncate">{preset.label}</span>
                  {settings.azure_speech_voice === preset.value && (
                    <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0 ml-1" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 2: YouTube Live Stream */}
        <section className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-xs font-black text-indigo-700 uppercase tracking-widest flex items-center gap-2">
              <Tv className="w-4 h-4 text-indigo-600" />
              YouTube Live Stream
            </h2>

            {/* Toggle Switch */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">
                {settings.enable_youtube ? 'Active' : 'Disabled'}
              </span>
              <button
                type="button"
                onClick={() => updateField('enable_youtube', !settings.enable_youtube)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                  settings.enable_youtube ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
                aria-label="Toggle YouTube live listener"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                    settings.enable_youtube ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Channel ID */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                YouTube Channel ID
              </label>
              <span className="text-[10px] text-slate-400">24-char ID (UC...)</span>
            </div>
            <input
              type="text"
              value={settings.youtube_channel_id}
              onChange={(e) => updateField('youtube_channel_id', e.target.value)}
              placeholder="e.g. UCiz4lqlVpaB4PpK-1aecMgQ"
              className={`w-full px-4 py-2.5 bg-slate-50 border rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white font-mono text-sm transition-colors ${
                fieldErrors.youtube_channel_id
                  ? 'border-rose-500 focus:border-rose-500'
                  : 'border-slate-300 focus:border-indigo-600'
              }`}
            />
            {fieldErrors.youtube_channel_id ? (
              <p className="text-xs text-rose-600 mt-1 flex items-center gap-1 font-medium">
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
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Live Video ID Override
              </label>
              <span className="text-[10px] text-slate-400 font-mono">Optional</span>
            </div>
            <input
              type="text"
              value={settings.youtube_live_id ?? ''}
              onChange={(e) => updateField('youtube_live_id', e.target.value || null)}
              placeholder="e.g. jfKfPfyJRdk (leave empty for auto-detect)"
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-indigo-600 font-mono text-sm transition-colors"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Specify this only if you want to lock BABA TTS to a specific broadcast or scheduled stream URL.
            </p>
          </div>

          {/* Live status badge */}
          <div className="mt-auto p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-2.5 text-xs text-slate-600">
            <Radio
              className={`w-4 h-4 ${
                settings.enable_youtube ? 'text-indigo-600 animate-pulse' : 'text-slate-400'
              }`}
            />
            <div>
              <span className="font-semibold text-slate-800">
                {settings.enable_youtube ? 'Live Listener Active' : 'Live Listener Inactive'}
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
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>
            Persisted in SQLite (<span className="font-mono text-indigo-700">baba.db</span>). Applies live instantly without server restart.
          </span>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors"
            title="Reset form fields to default values"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>Reset Defaults</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-xs ${
              justSaved
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white'
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
