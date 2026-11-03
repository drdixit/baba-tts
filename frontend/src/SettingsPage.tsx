import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Save, Loader2, Check, AlertCircle } from 'lucide-react';

interface AppSettings {
  azure_speech_key: string;
  azure_speech_region: string;
  azure_speech_voice: string;
  youtube_channel_id: string;
  youtube_live_id: string | null;
  enable_youtube: boolean;
}

// Wire camelCase JSON keys from the Rust API to snake_case field names
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

export default function SettingsPage() {
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
      <div className="h-screen w-screen flex items-center justify-center bg-gray-900">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-900 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            to="/"
            className="p-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold text-white tracking-wide">Settings</h1>
        </div>

        {/* Banner */}
        {banner && (
          <div
            className={`mb-6 flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium ${
              banner.type === 'success'
                ? 'bg-green-900/40 text-green-300 border border-green-800/50'
                : 'bg-red-900/40 text-red-300 border border-red-800/50'
            }`}
          >
            {banner.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            {banner.message}
          </div>
        )}

        {/* Azure Speech Section */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-300 uppercase tracking-wider mb-4">
            Azure Speech
          </h2>
          <div className="space-y-4 bg-gray-800 rounded-2xl p-6 border border-gray-700">
            {/* Speech Key */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Speech Key
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.azure_speech_key}
                  onChange={(e) => updateField('azure_speech_key', e.target.value)}
                  placeholder="Enter your Azure Speech key"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 pr-12 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Speech Region */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Speech Region
              </label>
              <input
                type="text"
                value={settings.azure_speech_region}
                onChange={(e) => updateField('azure_speech_region', e.target.value)}
                placeholder="e.g. centralindia, eastus, westeurope"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
              />
            </div>

            {/* Speech Voice */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Voice Name
                <span className="text-gray-600 font-normal ml-2">(leave empty for random Hindi voices)</span>
              </label>
              <input
                type="text"
                value={settings.azure_speech_voice}
                onChange={(e) => updateField('azure_speech_voice', e.target.value)}
                placeholder="hi-IN-MadhurNeural"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm"
              />
            </div>
          </div>
        </section>

        {/* YouTube Section */}
        <section className="mb-8">
          <h2 className="text-lg font-bold text-gray-300 uppercase tracking-wider mb-4">
            YouTube
          </h2>
          <div className="space-y-4 bg-gray-800 rounded-2xl p-6 border border-gray-700">
            {/* Enable YouTube Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium text-gray-300">Enable YouTube Polling</label>
                <p className="text-xs text-gray-500 mt-0.5">
                  Connect to YouTube Live chat and read messages
                </p>
              </div>
              <button
                type="button"
                onClick={() => updateField('enable_youtube', !settings.enable_youtube)}
                className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${
                  settings.enable_youtube ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${
                    settings.enable_youtube ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Channel ID */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Channel ID
              </label>
              <input
                type="text"
                value={settings.youtube_channel_id}
                onChange={(e) => updateField('youtube_channel_id', e.target.value)}
                placeholder="UCiz4lqlVpaB4PpK-1aecMgQ"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-sm"
              />
            </div>

            {/* Live ID */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">
                Live ID
                <span className="text-gray-600 font-normal ml-2">(optional — for unlisted streams)</span>
              </label>
              <input
                type="text"
                value={settings.youtube_live_id ?? ''}
                onChange={(e) => updateField('youtube_live_id', e.target.value || null)}
                placeholder="e.g. nt_s3O3SWAM"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono text-sm"
              />
            </div>
          </div>
        </section>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-2xl text-lg font-bold text-white transition-colors shadow-xl"
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Save className="w-5 h-5" />
          )}
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        <p className="text-center text-xs text-gray-600 mt-4">
          Settings are applied immediately. TTS voice changes take effect on the next message.
        </p>
      </div>
    </div>
  );
}
