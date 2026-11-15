import { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Save,
  Loader2,
  Check,
  AlertCircle,
  RotateCcw,
  RefreshCw,
  ChevronDown,
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

interface SettingsPanelProps {
  onRestart: () => void;
  serverPort: number;
}

export default function SettingsPanel({ onRestart, serverPort }: SettingsPanelProps) {
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
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        <span className="text-xs font-semibold">Loading settings from database...</span>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4 text-slate-800">
      {/* Fluent InfoBar Status Banner */}
      {banner && (
        <div
          className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-normal border transition-all ${
            banner.type === 'success'
              ? 'bg-[#DFF6DD] text-[#107C41] border-[#107C41]/30'
              : 'bg-[#FDE7E9] text-[#A80000] border-[#A80000]/30'
          }`}
        >
          {banner.type === 'success' ? (
            <Check className="w-4 h-4 shrink-0 text-[#107C41]" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-[#A80000]" />
          )}
          <span>{banner.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* SECTION 1: Azure Speech Service */}
        <section className="desktop-panel p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
            <h2 className="text-xs font-semibold text-slate-800 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-600" />
              Azure speech service
            </h2>
          </div>

          {/* Subscription Key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700">
                Speech subscription key
              </label>
              <span className="text-xs text-slate-400">Azure AI Portal</span>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.azure_speech_key}
                onChange={(e) => updateField('azure_speech_key', e.target.value)}
                placeholder="Paste your 32-character Azure Speech Key"
                className="w-full h-8 px-2.5 pr-8 bg-white border border-black/[0.15] border-b-black/[0.3] rounded-[4px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#64748B] focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none font-mono text-xs transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1 rounded-[3px] focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Required for real-time neural speech synthesis and word-level karaoke synchronization.
            </p>
          </div>

          {/* Region */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700">
                Speech region
              </label>
              <span className="text-xs text-slate-400 font-mono">e.g. centralindia</span>
            </div>
            <input
              type="text"
              list="azure-speech-regions"
              value={settings.azure_speech_region}
              onChange={(e) => updateField('azure_speech_region', e.target.value)}
              placeholder="e.g. centralindia"
              className={`w-full h-8 px-2.5 bg-white border border-b-black/[0.3] rounded-[4px] text-slate-900 placeholder-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none font-mono text-xs transition-colors ${
                fieldErrors.azure_speech_region
                  ? 'border-rose-500 focus:border-rose-500'
                  : 'border-black/[0.15] focus:border-[#64748B]'
              }`}
            />
            <datalist id="azure-speech-regions">
              {REGION_PRESETS.map((region) => <option key={region} value={region} />)}
            </datalist>
            {fieldErrors.azure_speech_region && (
              <p className="text-xs text-rose-600 mt-1 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3 h-3" />
                {fieldErrors.azure_speech_region}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">Type a region or choose a suggestion.</p>
          </div>

          {/* Default Voice */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700">
                Default neural voice
              </label>
              <span className="text-xs text-slate-400">Neural voice name</span>
            </div>
            <input
              type="text"
              list="azure-neural-voices"
              value={settings.azure_speech_voice}
              onChange={(e) => updateField('azure_speech_voice', e.target.value)}
              placeholder="hi-IN-MadhurNeural"
              className="w-full h-8 px-2.5 bg-white border border-black/[0.15] border-b-black/[0.3] rounded-[4px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#64748B] focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none font-mono text-xs transition-colors"
            />
            <datalist id="azure-neural-voices">
              {VOICE_PRESETS.map((preset) => <option key={preset.value} value={preset.value} label={preset.label} />)}
            </datalist>
            <p className="text-xs text-slate-500 mt-1">Type a voice name or choose a suggestion.</p>
          </div>
        </section>

        {/* SECTION 2: YouTube Live Stream */}
        <section className="desktop-panel p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-black/[0.06]">
            <h2 className="text-xs font-semibold text-slate-800 flex items-center gap-2">
              <Tv className="w-4 h-4 text-slate-600" />
              YouTube live stream
            </h2>

            {/* Toggle Switch */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {settings.enable_youtube ? 'Enabled' : 'Disabled'}
              </span>
              <button
                type="button"
                onClick={() => updateField('enable_youtube', !settings.enable_youtube)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none ${
                  settings.enable_youtube ? 'bg-slate-800' : 'bg-slate-300'
                }`}
                aria-label="Toggle YouTube live listener"
                role="switch"
                aria-checked={settings.enable_youtube}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-xs transition-transform duration-150 ${
                    settings.enable_youtube ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Channel ID */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-700">
                YouTube channel ID
              </label>
              <span className="text-xs text-slate-400">24-char ID (UC...)</span>
            </div>
            <input
              type="text"
              value={settings.youtube_channel_id}
              onChange={(e) => updateField('youtube_channel_id', e.target.value)}
              placeholder="e.g. UCiz4lqlVpaB4PpK-1aecMgQ"
              className={`w-full h-8 px-2.5 bg-white border border-b-black/[0.3] rounded-[4px] text-slate-900 placeholder-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none font-mono text-xs transition-colors ${
                fieldErrors.youtube_channel_id
                  ? 'border-rose-500 focus:border-rose-500'
                  : 'border-black/[0.15] focus:border-[#64748B]'
              }`}
            />
            {fieldErrors.youtube_channel_id ? (
              <p className="text-xs text-rose-600 mt-1 flex items-center gap-1 font-medium">
                <AlertCircle className="w-3 h-3" />
                {fieldErrors.youtube_channel_id}
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-1">
                BABA automatically detects your active live stream broadcast under this channel ID.
              </p>
            )}
          </div>

          <details className="group border-t border-slate-200 pt-3">
            <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64748B] [&::-webkit-details-marker]:hidden">
              Advanced: specific live video
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="pt-2">
              <label htmlFor="youtube-live-id" className="text-xs font-medium text-slate-700">
                Live video ID override
              </label>
              <input
                id="youtube-live-id"
                type="text"
                value={settings.youtube_live_id ?? ''}
                onChange={(e) => updateField('youtube_live_id', e.target.value || null)}
                placeholder="Leave blank to detect automatically"
                className="mt-1.5 w-full h-9 px-2.5 bg-white border border-black/[0.15] border-b-black/[0.3] rounded-[4px] text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#64748B] focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none font-mono text-xs transition-colors"
              />
            </div>
          </details>
        </section>
      </div>

      <details className="group desktop-panel px-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64748B] [&::-webkit-details-marker]:hidden">
          Reset and maintenance
          <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-200 py-3">
          <div className="text-xs text-slate-500">
            Local server · Port <span className="font-mono text-slate-700">{serverPort}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="min-h-9 px-3 rounded-md bg-white hover:bg-slate-100 border border-slate-300 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none"
              title="Reset form fields to default values"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>Reset defaults</span>
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="min-h-9 px-3 rounded-md bg-white hover:bg-slate-100 border border-slate-300 text-xs font-medium text-slate-700 transition-colors flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none"
              title="Restart the local BABA TTS server"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>Restart server</span>
            </button>
          </div>
        </div>
      </details>

      {/* Save Settings Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-black/[0.06]">
        <span className="text-xs text-slate-500">Save to apply changes now.</span>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`min-h-10 px-4 rounded-md text-sm font-medium transition-all shadow-[0_1px_2px_rgba(0,0,0,0.08)] flex items-center justify-center gap-1.5 focus-visible:ring-2 focus-visible:ring-[#64748B] focus-visible:outline-none ${
              justSaved
                ? 'bg-[#107C41] text-white'
                : 'bg-[#333333] hover:bg-[#1F1F1F] text-white disabled:bg-slate-200 disabled:text-slate-400'
            }`}
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : justSaved ? (
              <>
                <Check className="w-3.5 h-3.5 text-white" />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save settings</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
