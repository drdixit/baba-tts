import { useEffect, useState } from 'react';
import { Eye, EyeOff, Save, Loader2, Check, AlertCircle } from 'lucide-react';

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
    azure_speech_key: api.azureSpeechKey,
    azure_speech_region: api.azureSpeechRegion,
    azure_speech_voice: api.azureSpeechVoice,
    youtube_channel_id: api.youtubeChannelId,
    youtube_live_id: api.youtubeLiveId,
    enable_youtube: api.enableYoutube,
  };
}

function formToApi(form: AppSettings): ApiSettings {
  return {
    azureSpeechKey: form.azure_speech_key,
    azureSpeechRegion: form.azure_speech_region,
    azureSpeechVoice: form.azure_speech_voice,
    youtubeChannelId: form.youtube_channel_id,
    youtubeLiveId: form.youtube_live_id || null,
    enableYoutube: form.enable_youtube,
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  azure_speech_key: '',
  azure_speech_region: 'centralindia',
  azure_speech_voice: '',
  youtube_channel_id: '',
  youtube_live_id: null,
  enable_youtube: true,
};

type BannerState = { type: 'success' | 'error'; message: string } | null;

interface SettingsPanelProps {
  onClose?: () => void;
}

export default function SettingsPanel({ onClose: _onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [banner, setBanner] = useState<BannerState>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data: ApiSettings) => {
        setSettings(apiToForm(data));
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setBanner({ type: 'error', message: 'Failed to load settings. Is the server running?' });
      });
  }, []);

  useEffect(() => {
    if (banner) {
      const timer = setTimeout(() => setBanner(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [banner]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToApi(settings)),
      });
      if (res.ok) {
        setBanner({ type: 'success', message: 'Settings saved successfully!' });
      } else {
        const text = await res.text();
        setBanner({ type: 'error', message: `Failed to save: ${text}` });
      }
    } catch {
      setBanner({ type: 'error', message: 'Failed to save settings. Check your connection.' });
    } finally {
      setSaving(false);
    }
  };

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 p-2 text-white">
      {/* Banner */}
      {banner && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
            banner.type === 'success'
              ? 'bg-green-900/50 text-green-300 border border-green-700/60'
              : 'bg-red-900/50 text-red-300 border border-red-700/60'
          }`}
        >
          {banner.type === 'success' ? (
            <Check className="w-4 h-4 shrink-0 text-green-400" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
          )}
          <span>{banner.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Azure Speech Section */}
        <section className="bg-gray-800/90 rounded-2xl p-6 border border-gray-700 shadow-lg flex flex-col gap-4">
          <h2 className="text-sm font-black text-cyan-400 uppercase tracking-widest flex items-center gap-2">
            Azure Speech Service
          </h2>

          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5">
              Speech Subscription Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.azure_speech_key}
                onChange={(e) => updateField('azure_speech_key', e.target.value)}
                placeholder="Enter your Azure Speech key"
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono text-sm pr-11"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5">
              Region
            </label>
            <input
              type="text"
              value={settings.azure_speech_region}
              onChange={(e) => updateField('azure_speech_region', e.target.value)}
              placeholder="e.g. centralindia, eastus"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5">
              Default Voice
              <span className="text-gray-500 font-normal lowercase ml-2">(leave empty for random Hindi)</span>
            </label>
            <input
              type="text"
              value={settings.azure_speech_voice}
              onChange={(e) => updateField('azure_speech_voice', e.target.value)}
              placeholder="hi-IN-MadhurNeural"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono text-sm"
            />
          </div>
        </section>

        {/* YouTube Section */}
        <section className="bg-gray-800/90 rounded-2xl p-6 border border-gray-700 shadow-lg flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-purple-400 uppercase tracking-widest flex items-center gap-2">
              YouTube Live Stream
            </h2>

            {/* Toggle */}
            <button
              type="button"
              onClick={() => updateField('enable_youtube', !settings.enable_youtube)}
              className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                settings.enable_youtube ? 'bg-cyan-500' : 'bg-gray-600'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                  settings.enable_youtube ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5">
              Channel ID
            </label>
            <input
              type="text"
              value={settings.youtube_channel_id}
              onChange={(e) => updateField('youtube_channel_id', e.target.value)}
              placeholder="UCiz4lqlVpaB4PpK-1aecMgQ"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-1.5">
              Live Stream ID Override
              <span className="text-gray-500 font-normal lowercase ml-2">(optional)</span>
            </label>
            <input
              type="text"
              value={settings.youtube_live_id ?? ''}
              onChange={(e) => updateField('youtube_live_id', e.target.value || null)}
              placeholder="e.g. videoId"
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 font-mono text-sm"
            />
          </div>
        </section>
      </div>

      {/* Save Settings Action Bar */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-gray-400">
          Saved in SQLite (<span className="font-mono text-cyan-300">baba.db</span>). Applies live instantly.
        </p>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 rounded-xl text-sm font-bold text-white transition-colors shadow-lg"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>{saving ? 'Saving...' : 'Save Settings'}</span>
        </button>
      </div>
    </div>
  );
}
