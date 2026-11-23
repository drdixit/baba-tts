import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Volume2,
  Gauge,
  Cpu,
} from 'lucide-react';

interface AppSettings {
  tts_provider: 'azure' | 'sapi5';
  azure_speech_key: string;
  azure_speech_region: string;
  azure_speech_voice: string;
  azure_speech_voices: string[];
  azure_speech_voice_rotation: boolean;
  sapi_voice: string;
  sapi_voices: string[];
  sapi_voice_rotation: boolean;
  sapi_rate: number;
  sapi_volume: number;
  master_volume: number;
  youtube_channel_id: string;
  youtube_live_id: string | null;
  enable_youtube: boolean;
  youtube_chat_mode: 'live' | 'top';
  enable_facebook: boolean;
  facebook_access_token: string;
  facebook_target_id: string;
  facebook_live_id: string | null;
  enable_instagram: boolean;
  instagram_access_token: string;
  instagram_user_id: string;
  instagram_live_id: string | null;
}

interface ApiSettings {
  ttsProvider?: 'azure' | 'sapi5';
  azureSpeechKeyConfigured: boolean;
  azureSpeechRegion: string;
  azureSpeechVoice: string;
  azureSpeechVoices?: string[];
  azureSpeechVoiceRotation?: boolean;
  sapiVoice?: string;
  sapiVoices?: string[];
  sapiVoiceRotation?: boolean;
  sapiRate?: number;
  sapiVolume?: number;
  masterVolume?: number;
  youtubeChannelId: string;
  youtubeLiveId: string | null;
  enableYoutube: boolean;
  youtubeChatMode?: 'live' | 'top';
  enableFacebook?: boolean;
  facebookAccessTokenConfigured?: boolean;
  facebookTargetId?: string;
  facebookLiveId?: string | null;
  enableInstagram?: boolean;
  instagramAccessTokenConfigured?: boolean;
  instagramUserId?: string;
  instagramLiveId?: string | null;
}

interface SpeechVoice {
  shortName: string;
  displayName: string;
  localName?: string | null;
  locale: string;
  localeName?: string | null;
  gender?: string | null;
  voiceType?: string | null;
  status?: string | null;
  styleList?: string[] | null;
  secondaryLocaleList?: string[] | null;
}

interface VoiceCatalog {
  region: string;
  count: number;
  voices: SpeechVoice[];
}

function apiToForm(api: ApiSettings): AppSettings {
  return {
    tts_provider: api.ttsProvider === 'sapi5' ? 'sapi5' : 'azure',
    azure_speech_key: '',
    azure_speech_region: api.azureSpeechRegion || 'centralindia',
    azure_speech_voice: api.azureSpeechVoice || 'hi-IN-MadhurNeural',
    azure_speech_voices: api.azureSpeechVoices?.length
      ? api.azureSpeechVoices
      : [api.azureSpeechVoice || 'hi-IN-MadhurNeural'],
    azure_speech_voice_rotation: api.azureSpeechVoiceRotation ?? false,
    sapi_voice: api.sapiVoice || 'default',
    sapi_voices: api.sapiVoices?.length ? api.sapiVoices : [api.sapiVoice || 'default'],
    sapi_voice_rotation: api.sapiVoiceRotation ?? false,
    sapi_rate: api.sapiRate ?? 0,
    sapi_volume: api.sapiVolume ?? 100,
    master_volume: api.masterVolume ?? 100,
    youtube_channel_id: api.youtubeChannelId || '',
    youtube_live_id: api.youtubeLiveId || null,
    enable_youtube: api.enableYoutube ?? true,
    youtube_chat_mode: api.youtubeChatMode === 'top' ? 'top' : 'live',
    enable_facebook: api.enableFacebook ?? false,
    facebook_access_token: '',
    facebook_target_id: api.facebookTargetId || 'me',
    facebook_live_id: api.facebookLiveId || null,
    enable_instagram: api.enableInstagram ?? false,
    instagram_access_token: '',
    instagram_user_id: api.instagramUserId || '',
    instagram_live_id: api.instagramLiveId || null,
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  tts_provider: 'azure',
  azure_speech_key: '',
  azure_speech_region: 'centralindia',
  azure_speech_voice: 'hi-IN-MadhurNeural',
  azure_speech_voices: ['hi-IN-MadhurNeural'],
  azure_speech_voice_rotation: false,
  sapi_voice: 'default',
  sapi_voices: ['default'],
  sapi_voice_rotation: false,
  sapi_rate: 0,
  sapi_volume: 100,
  master_volume: 100,
  youtube_channel_id: 'UCiz4lqlVpaB4PpK-1aecMgQ',
  youtube_live_id: null,
  enable_youtube: true,
  youtube_chat_mode: 'live',
  enable_facebook: false,
  facebook_access_token: '',
  facebook_target_id: 'me',
  facebook_live_id: null,
  enable_instagram: false,
  instagram_access_token: '',
  instagram_user_id: '',
  instagram_live_id: null,
};

const REGION_PRESETS = [
  ['australiaeast', 'Australia East'],
  ['brazilsouth', 'Brazil South'],
  ['canadacentral', 'Canada Central'],
  ['canadaeast', 'Canada East'],
  ['centralindia', 'Central India'],
  ['centralus', 'Central US'],
  ['eastasia', 'East Asia'],
  ['eastus', 'East US'],
  ['eastus2', 'East US 2'],
  ['francecentral', 'France Central'],
  ['germanywestcentral', 'Germany West Central'],
  ['italynorth', 'Italy North'],
  ['japaneast', 'Japan East'],
  ['japanwest', 'Japan West'],
  ['koreacentral', 'Korea Central'],
  ['northcentralus', 'North Central US'],
  ['northeurope', 'North Europe'],
  ['norwayeast', 'Norway East'],
  ['qatarcentral', 'Qatar Central'],
  ['southafricanorth', 'South Africa North'],
  ['southcentralus', 'South Central US'],
  ['southeastasia', 'Southeast Asia'],
  ['swedencentral', 'Sweden Central'],
  ['switzerlandnorth', 'Switzerland North'],
  ['switzerlandwest', 'Switzerland West'],
  ['uaenorth', 'UAE North'],
  ['uksouth', 'UK South'],
  ['ukwest', 'UK West'],
  ['westcentralus', 'West Central US'],
  ['westeurope', 'West Europe'],
  ['westus', 'West US'],
  ['westus2', 'West US 2'],
  ['westus3', 'West US 3'],
] as const;

const presetRegionIds = new Set(REGION_PRESETS.map(([region]) => region));

interface SettingsPanelProps {
  onRestart: () => void;
  serverPort: number;
}

const fieldClass = 'h-7 w-full min-w-0 rounded-[2px] border border-[#BDBDBD] bg-white px-2 text-xs text-[#1F1F1F] outline-none transition-colors placeholder:text-[#777] hover:border-[#808080] focus:border-[#555] focus-visible:ring-1 focus-visible:ring-[#555]';
const secondaryButtonClass = 'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[2px] border border-[#C8C8C8] bg-white px-2 text-[11px] font-medium text-[#2B2B2B] transition-colors hover:bg-[#F1F1F1] active:bg-[#E7E7E7] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555] disabled:cursor-not-allowed disabled:opacity-50';

export default function SettingsPanel({ onRestart, serverPort }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [showFacebookToken, setShowFacebookToken] = useState(false);
  const [facebookTokenConfigured, setFacebookTokenConfigured] = useState(false);
  const [clearFacebookToken, setClearFacebookToken] = useState(false);
  const [testingFacebook, setTestingFacebook] = useState(false);
  const [facebookTestResult, setFacebookTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [showInstagramToken, setShowInstagramToken] = useState(false);
  const [instagramTokenConfigured, setInstagramTokenConfigured] = useState(false);
  const [clearInstagramToken, setClearInstagramToken] = useState(false);
  const [testingInstagram, setTestingInstagram] = useState(false);
  const [instagramTestResult, setInstagramTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [customRegion, setCustomRegion] = useState(false);
  const [customVoice, setCustomVoice] = useState(false);
  const [customVoiceHidden, setCustomVoiceHidden] = useState(false);
  const [savedRegion, setSavedRegion] = useState('');
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog | null>(null);
  const [catalogState, setCatalogState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [catalogError, setCatalogError] = useState('');
  const [voiceSearch, setVoiceSearch] = useState('');
  const [localeFilter, setLocaleFilter] = useState('all');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [justSaved, setJustSaved] = useState(false);
  const catalogRequest = useRef<AbortController | null>(null);

  const loadVoiceCatalog = useCallback(async (region: string, provider: 'azure' | 'sapi5' = 'azure') => {
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    setCatalogState('loading');
    setCatalogError('');

    try {
      const endpoint = provider === 'sapi5'
        ? '/api/voices?provider=sapi5'
        : `/api/voices?region=${encodeURIComponent(region)}`;
      const response = await fetch(endpoint, {
        signal: controller.signal,
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
          ? result.error
          : `Voice list request failed (${response.status}).`;
        throw new Error(message);
      }
      if (!result || typeof result !== 'object' || !('voices' in result) || !Array.isArray(result.voices)) {
        throw new Error('TTS service returned an invalid voice list.');
      }

      setVoiceCatalog(result as VoiceCatalog);
      setCatalogState('ready');
      setLocaleFilter('all');
    } catch (error) {
      if (controller.signal.aborted) return;
      setVoiceCatalog(null);
      setCatalogState('error');
      setCatalogError(error instanceof Error ? error.message : 'Could not load voices.');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function fetchSettings() {
      try {
        const response = await fetch('/api/settings', { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load settings (${response.status}).`);
        const data = (await response.json()) as ApiSettings;
        if (cancelled) return;

        const region = data.azureSpeechRegion || 'centralindia';
        const formSettings = apiToForm(data);
        setSettings(formSettings);
        setSavedRegion(region);
        setCustomRegion(!presetRegionIds.has(region as (typeof REGION_PRESETS)[number][0]));
        setKeyConfigured(data.azureSpeechKeyConfigured);
        setFacebookTokenConfigured(Boolean(data.facebookAccessTokenConfigured));
        setInstagramTokenConfigured(Boolean(data.instagramAccessTokenConfigured));
        
        if (formSettings.tts_provider === 'sapi5') {
          void loadVoiceCatalog('', 'sapi5');
        } else if (data.azureSpeechKeyConfigured) {
          void loadVoiceCatalog(region, 'azure');
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setBanner({
          type: 'error',
          message: error instanceof Error ? error.message : 'Could not load settings.',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchSettings();
    return () => {
      cancelled = true;
      controller.abort();
      catalogRequest.current?.abort();
    };
  }, [loadVoiceCatalog]);

  const updateField = <K extends keyof AppSettings>(field: K, value: AppSettings[K]) => {
    setSettings((previous) => ({ ...previous, [field]: value }));
    if (field === 'azure_speech_key' && value) setClearKey(false);
    if (field === 'facebook_access_token' && value) setClearFacebookToken(false);
    if (field === 'instagram_access_token' && value) setClearInstagramToken(false);
    if (fieldErrors[field]) {
      setFieldErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  };

  const handleTestFacebook = async () => {
    setTestingFacebook(true);
    setFacebookTestResult(null);
    try {
      const resp = await fetch('/api/meta/test-facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: settings.facebook_access_token.trim() || undefined,
          targetId: settings.facebook_target_id.trim() || undefined,
        }),
      });
      const data = await resp.json();
      if (data.valid) {
        setFacebookTestResult({
          success: true,
          message: `Connected as ${data.name || data.id || 'User'}!`,
        });
      } else {
        setFacebookTestResult({
          success: false,
          message: data.errorMessage || 'Invalid Facebook token or Target ID.',
        });
      }
    } catch (e) {
      setFacebookTestResult({
        success: false,
        message: e instanceof Error ? e.message : 'Network error testing Facebook token.',
      });
    } finally {
      setTestingFacebook(false);
    }
  };

  const handleTestInstagram = async () => {
    setTestingInstagram(true);
    setInstagramTestResult(null);
    try {
      const resp = await fetch('/api/meta/test-instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: settings.instagram_access_token.trim() || undefined,
          targetId: settings.instagram_user_id.trim() || undefined,
        }),
      });
      const data = await resp.json();
      if (data.valid) {
        setInstagramTestResult({
          success: true,
          message: `Connected as ${data.username || data.name || data.id || 'User'}!`,
        });
      } else {
        setInstagramTestResult({
          success: false,
          message: data.errorMessage || 'Invalid Instagram token or User ID.',
        });
      }
    } catch (e) {
      setInstagramTestResult({
        success: false,
        message: e instanceof Error ? e.message : 'Network error testing Instagram token.',
      });
    } finally {
      setTestingInstagram(false);
    }
  };

  const handleProviderSwitch = (provider: 'azure' | 'sapi5') => {
    updateField('tts_provider', provider);
    if (provider === 'sapi5') {
      void loadVoiceCatalog('', 'sapi5');
    } else {
      if (keyConfigured) {
        void loadVoiceCatalog(savedRegion || settings.azure_speech_region, 'azure');
      } else {
        setVoiceCatalog(null);
        setCatalogState('idle');
      }
    }
  };

  const selectSingleVoice = (voice: string) => {
    if (settings.tts_provider === 'sapi5') {
      setSettings((previous) => ({
        ...previous,
        sapi_voice: voice,
        sapi_voices: [voice],
      }));
    } else {
      setCustomVoice(false);
      setCustomVoiceHidden(false);
      setSettings((previous) => ({
        ...previous,
        azure_speech_voice: voice,
        azure_speech_voices: [voice],
      }));
    }
  };

  const toggleRotationVoice = (voice: string, checked: boolean) => {
    if (settings.tts_provider === 'sapi5') {
      setSettings((previous) => {
        const selected = previous.sapi_voices;
        const next = checked
          ? [...selected.filter((item) => item !== voice), voice]
          : selected.filter((item) => item !== voice);
        if (next.length === 0) return previous;
        const primary = next.includes(previous.sapi_voice) ? previous.sapi_voice : next[0];
        return {
          ...previous,
          sapi_voice: primary,
          sapi_voices: next,
        };
      });
    } else {
      setCustomVoice(false);
      setCustomVoiceHidden(false);
      setSettings((previous) => {
        const selected = previous.azure_speech_voices;
        const next = checked
          ? [...selected.filter((item) => item !== voice), voice]
          : selected.filter((item) => item !== voice);
        if (next.length === 0) return previous;
        const primary = next.includes(previous.azure_speech_voice) ? previous.azure_speech_voice : next[0];
        return {
          ...previous,
          azure_speech_voice: primary,
          azure_speech_voices: next,
        };
      });
    }
  };

  const moveRotationVoice = (voice: string, offset: -1 | 1) => {
    if (settings.tts_provider === 'sapi5') {
      setSettings((previous) => {
        const voices = [...previous.sapi_voices];
        const index = voices.indexOf(voice);
        const nextIndex = index + offset;
        if (index < 0 || nextIndex < 0 || nextIndex >= voices.length) return previous;
        [voices[index], voices[nextIndex]] = [voices[nextIndex], voices[index]];
        return { ...previous, sapi_voice: voices[0], sapi_voices: voices };
      });
    } else {
      setSettings((previous) => {
        const voices = [...previous.azure_speech_voices];
        const index = voices.indexOf(voice);
        const nextIndex = index + offset;
        if (index < 0 || nextIndex < 0 || nextIndex >= voices.length) return previous;
        [voices[index], voices[nextIndex]] = [voices[nextIndex], voices[index]];
        return { ...previous, azure_speech_voice: voices[0], azure_speech_voices: voices };
      });
    }
  };

  const toggleCustomRegion = () => {
    if (customRegion) {
      if (!presetRegionIds.has(settings.azure_speech_region as (typeof REGION_PRESETS)[number][0])) {
        updateField('azure_speech_region', 'centralindia');
      }
      setCustomRegion(false);
    } else {
      setCustomRegion(true);
    }
  };

  const validate = () => {
    const errors: Record<string, string> = {};
    if (settings.tts_provider === 'azure') {
      if (!settings.azure_speech_region.trim()) {
        errors.azure_speech_region = 'Enter your Azure Speech region.';
      }
      if (settings.azure_speech_voice_rotation && settings.azure_speech_voices.length === 0) {
        errors.azure_speech_voices = 'Select at least one voice for rotation.';
      }
    } else if (settings.tts_provider === 'sapi5') {
      if (settings.sapi_voice_rotation && settings.sapi_voices.length === 0) {
        errors.sapi_voices = 'Select at least one SAPI voice for rotation.';
      }
    }
    if (settings.enable_youtube && !settings.youtube_channel_id.trim()) {
      errors.youtube_channel_id = 'Enter a YouTube channel ID or turn off the listener.';
    }
    if (settings.enable_facebook && !facebookTokenConfigured && !settings.facebook_access_token.trim()) {
      errors.facebook_access_token = 'Enter a Meta access token or turn off Facebook Live.';
    }
    if (settings.enable_instagram) {
      if (!instagramTokenConfigured && !settings.instagram_access_token.trim()) {
        errors.instagram_access_token = 'Enter an Instagram access token or turn off Instagram Live.';
      }
      if (!settings.instagram_user_id.trim()) {
        errors.instagram_user_id = 'Enter an Instagram User ID or turn off Instagram Live.';
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      setBanner({ type: 'error', message: 'Check the highlighted fields before saving.' });
      return;
    }

    try {
      setSaving(true);
      setBanner(null);
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ttsProvider: settings.tts_provider,
          azureSpeechKey: settings.azure_speech_key.trim(),
          clearAzureSpeechKey: clearKey,
          azureSpeechRegion: settings.azure_speech_region.trim() || 'centralindia',
          azureSpeechVoice: settings.azure_speech_voice.trim() || 'hi-IN-MadhurNeural',
          azureSpeechVoices: settings.azure_speech_voices.length ? settings.azure_speech_voices : [settings.azure_speech_voice],
          azureSpeechVoiceRotation: settings.azure_speech_voice_rotation,
          sapiVoice: settings.sapi_voice.trim() || 'default',
          sapiVoices: settings.sapi_voices.length ? settings.sapi_voices : [settings.sapi_voice],
          sapiVoiceRotation: settings.sapi_voice_rotation,
          sapiRate: settings.sapi_rate,
          sapiVolume: settings.sapi_volume,
          youtubeChannelId: settings.youtube_channel_id.trim(),
          youtubeLiveId: settings.youtube_live_id?.trim() || null,
          enableYoutube: settings.enable_youtube,
          youtubeChatMode: settings.youtube_chat_mode,
          enableFacebook: settings.enable_facebook,
          facebookAccessToken: settings.facebook_access_token.trim(),
          clearFacebookAccessToken: clearFacebookToken,
          facebookTargetId: settings.facebook_target_id.trim() || 'me',
          facebookLiveId: settings.facebook_live_id?.trim() || null,
          enableInstagram: settings.enable_instagram,
          instagramAccessToken: settings.instagram_access_token.trim(),
          clearInstagramAccessToken: clearInstagramToken,
          instagramUserId: settings.instagram_user_id.trim(),
          instagramLiveId: settings.instagram_live_id?.trim() || null,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Save failed (${response.status}).`);
      }

      const result = await response.json();
      const hasKey = Boolean(result.settings?.azureSpeechKeyConfigured);
      const region = settings.azure_speech_region.trim() || 'centralindia';
      setKeyConfigured(hasKey);
      setClearKey(false);
      setSettings((previous) => ({
        ...previous,
        azure_speech_key: '',
        facebook_access_token: '',
        instagram_access_token: '',
      }));
      setFacebookTokenConfigured(Boolean(result.settings?.facebookAccessTokenConfigured));
      setClearFacebookToken(false);
      setInstagramTokenConfigured(Boolean(result.settings?.instagramAccessTokenConfigured));
      setClearInstagramToken(false);
      setSavedRegion(region);
      setBanner({ type: 'success', message: 'Settings saved and applied.' });
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2200);

      if (settings.tts_provider === 'sapi5') {
        await loadVoiceCatalog('', 'sapi5');
      } else if (hasKey) {
        await loadVoiceCatalog(region, 'azure');
      } else {
        catalogRequest.current?.abort();
        setVoiceCatalog(null);
        setCatalogState('idle');
      }
    } catch (error) {
      setBanner({
        type: 'error',
        message: error instanceof Error ? error.message : 'Could not save settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (!window.confirm('Reset settings to their defaults? The saved Azure key will be kept.')) return;
    setSettings({ ...DEFAULT_SETTINGS, azure_speech_key: '' });
    setClearKey(false);
    setCustomRegion(false);
    setCustomVoice(false);
    setCustomVoiceHidden(false);
    setFieldErrors({});
    setBanner({ type: 'success', message: 'Defaults loaded. Save to apply them.' });
  };

  const localeOptions = useMemo(() => {
    if (!voiceCatalog) return [];
    const locales = new Map<string, string>();
    for (const voice of voiceCatalog.voices) {
      if (voice.locale) locales.set(voice.locale, voice.localeName || voice.locale);
    }
    return [...locales.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [voiceCatalog]);

  const visibleVoices = useMemo(() => {
    if (!voiceCatalog) return [];
    const query = voiceSearch.trim().toLocaleLowerCase();
    return voiceCatalog.voices.filter((voice) => {
      const matchesLocale = localeFilter === 'all' || voice.locale === localeFilter;
      const searchable = [
        voice.shortName,
        voice.displayName,
        voice.localName,
        voice.locale,
        voice.localeName,
        voice.gender,
        voice.voiceType,
        ...(voice.styleList || []),
        ...(voice.secondaryLocaleList || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return matchesLocale && (!query || searchable.includes(query));
    });
  }, [localeFilter, voiceCatalog, voiceSearch]);

  const regionNeedsSave = settings.azure_speech_region.trim().toLowerCase() !== savedRegion.toLowerCase();
  const currentVoice = settings.tts_provider === 'sapi5' ? settings.sapi_voice : settings.azure_speech_voice;
  const currentVoiceAvailable = voiceCatalog?.voices.some(
    (voice) => voice.shortName === currentVoice,
  ) ?? false;
  const showCustomVoice = !customVoiceHidden && customVoice;

  if (loading) {
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-[#5C5C5C]">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Loading settings…</span>
      </div>
    );
  }

  const isSapi = settings.tts_provider === 'sapi5';

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 px-2 pt-2 pb-0 text-[#1F1F1F]">
      {banner && (
        <div
          role={banner.type === 'error' ? 'alert' : 'status'}
          className={`flex min-h-7 items-center gap-2 border-l-2 px-2 py-1 text-xs ${
            banner.type === 'success'
              ? 'border-[#5C5C5C] bg-white text-[#2B2B2B]'
              : 'border-[#A4262C] bg-[#FFF8F8] text-[#8A1F24]'
          }`}
        >
          {banner.type === 'success' ? (
            <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>{banner.message}</span>
        </div>
      )}

      {/* TTS Engine Switcher */}
      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend">TTS Engine / Provider</legend>
        <div className="desktop-setting-row">
          <span className="desktop-setting-label">Active Provider</span>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5 font-medium">
              <input
                type="radio"
                name="tts_provider"
                value="azure"
                checked={!isSapi}
                onChange={() => handleProviderSwitch('azure')}
                className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
              />
              Azure Speech (Cloud Neural)
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 font-medium text-[#1A4D2E]">
              <input
                type="radio"
                name="tts_provider"
                value="sapi5"
                checked={isSapi}
                onChange={() => handleProviderSwitch('sapi5')}
                className="h-3.5 w-3.5 accent-[#1A4D2E] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#1A4D2E]"
              />
              Windows Native SAPI5 (Offline / Free)
            </label>
          </div>
        </div>
        <p className="desktop-help-text pl-[132px]">
          {isSapi
            ? 'Using Microsoft SAPI5 COM engine on Windows. Runs completely offline without API keys or usage fees.'
            : 'Using Microsoft Azure Cognitive Services Speech. High-quality neural voices requiring an Azure API key.'}
        </p>
      </fieldset>

      {/* Master Audio Output (WASAPI) */}
      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend flex items-center gap-1.5">
          <Volume2 className="h-3.5 w-3.5 text-[#333]" aria-hidden="true" />
          <span>Master Audio Output (WASAPI / OBS)</span>
        </legend>
        <div className="desktop-setting-row">
          <label htmlFor="settings-master-volume" className="desktop-setting-label flex items-center gap-1">
            <span>Master Volume</span>
          </label>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <input
              id="settings-master-volume"
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.master_volume}
              onChange={(e) => updateField('master_volume', parseInt(e.target.value, 10))}
              className="h-2 w-full max-w-56 cursor-pointer accent-[#222]"
            />
            <span className="w-12 font-mono text-xs font-semibold text-[#333]">
              {settings.master_volume}%
            </span>
            <button
              type="button"
              onClick={() => updateField('master_volume', 100)}
              className={secondaryButtonClass}
              title="Reset to 100% (max output volume)"
            >
              Reset (100%)
            </button>
          </div>
        </div>
        <p className="desktop-help-text pl-[132px]">
          Global output volume rendered by the dedicated WASAPI audio worker. Directly controls audio captured by OBS Application Audio Capture.
        </p>
      </fieldset>

      {/* SAPI5 Controls */}
      {isSapi && (
        <fieldset className="desktop-groupbox">
          <legend className="desktop-groupbox-legend flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-[#1A4D2E]" aria-hidden="true" />
            <span>Windows SAPI5 Voice & Controls</span>
          </legend>

          <div className="desktop-setting-row">
            <label htmlFor="sapi-rate" className="desktop-setting-label flex items-center gap-1">
              <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Speaking Speed</span>
            </label>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <input
                id="sapi-rate"
                type="range"
                min={-10}
                max={10}
                step={1}
                value={settings.sapi_rate}
                onChange={(e) => updateField('sapi_rate', parseInt(e.target.value, 10))}
                className="h-2 w-full max-w-56 cursor-pointer accent-[#555]"
              />
              <span className="w-12 font-mono text-xs font-semibold text-[#333]">
                {settings.sapi_rate > 0 ? `+${settings.sapi_rate}` : settings.sapi_rate}
              </span>
              <button
                type="button"
                onClick={() => updateField('sapi_rate', 0)}
                className={secondaryButtonClass}
                title="Reset to 0 (normal speed)"
              >
                Reset (0)
              </button>
            </div>
          </div>

          <div className="desktop-setting-row">
            <label htmlFor="sapi-volume" className="desktop-setting-label flex items-center gap-1">
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Volume</span>
            </label>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <input
                id="sapi-volume"
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.sapi_volume}
                onChange={(e) => updateField('sapi_volume', parseInt(e.target.value, 10))}
                className="h-2 w-full max-w-56 cursor-pointer accent-[#555]"
              />
              <span className="w-12 font-mono text-xs font-semibold text-[#333]">
                {settings.sapi_volume}%
              </span>
              <button
                type="button"
                onClick={() => updateField('sapi_volume', 100)}
                className={secondaryButtonClass}
                title="Reset to 100% (max volume)"
              >
                Max (100)
              </button>
            </div>
          </div>
        </fieldset>
      )}

      {/* Azure Configuration */}
      {!isSapi && (
        <fieldset className="desktop-groupbox">
          <legend className="desktop-groupbox-legend">Azure Speech Configuration</legend>
          <div className="desktop-setting-row">
            <label htmlFor="azure-key" className="desktop-setting-label">Speech key</label>
            <div className="min-w-0">
              <div className="flex gap-1.5">
                <input
                  id="azure-key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={settings.azure_speech_key}
                  onChange={(event) => updateField('azure_speech_key', event.target.value)}
                  placeholder={keyConfigured ? 'Enter a new key to replace the saved key' : 'Paste Azure Speech key'}
                  className={`${fieldClass} font-mono`}
                />
                <button type="button" onClick={() => setShowKey((visible) => !visible)} className={secondaryButtonClass} title={showKey ? 'Hide key' : 'Show key'} aria-label={showKey ? 'Hide Azure Speech key' : 'Show Azure Speech key'}>
                  {showKey ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
                {keyConfigured && <button type="button" onClick={() => { setSettings((previous) => ({ ...previous, azure_speech_key: '' })); setClearKey((requested) => !requested); }} className={secondaryButtonClass} aria-pressed={clearKey}>{clearKey ? 'Keep key' : 'Clear key'}</button>}
                <span className="flex shrink-0 items-center px-1 text-[11px] text-[#555]">{keyConfigured ? 'Saved' : 'Not set'}</span>
              </div>
              <p className="desktop-help-text">{clearKey ? 'The saved key will be removed when you save.' : 'Leave blank to keep the saved key. Settings never returns the saved key.'}</p>
            </div>
          </div>

          <div className="desktop-setting-row">
            <label htmlFor="azure-region" className="desktop-setting-label">Speech region</label>
            <div className="min-w-0">
              <div className="flex gap-1.5">
                {customRegion ? (
                  <input
                    id="azure-region"
                    type="text"
                    value={settings.azure_speech_region}
                    onChange={(event) => updateField('azure_speech_region', event.target.value)}
                    placeholder="centralindia"
                    className={`${fieldClass} font-mono ${fieldErrors.azure_speech_region ? 'border-[#A4262C]' : ''}`}
                    aria-invalid={Boolean(fieldErrors.azure_speech_region)}
                    aria-describedby={fieldErrors.azure_speech_region ? 'azure-region-error' : undefined}
                  />
                ) : (
                  <select
                    id="azure-region"
                    value={presetRegionIds.has(settings.azure_speech_region as (typeof REGION_PRESETS)[number][0]) ? settings.azure_speech_region : 'centralindia'}
                    onChange={(event) => updateField('azure_speech_region', event.target.value)}
                    className={fieldClass}
                  >
                    {REGION_PRESETS.map(([region, label]) => <option key={region} value={region}>{label} ({region})</option>)}
                  </select>
                )}
                <button type="button" onClick={toggleCustomRegion} className={secondaryButtonClass}>{customRegion ? 'Use region list' : 'Edit…'}</button>
              </div>
              <p className="desktop-help-text">
                {fieldErrors.azure_speech_region ? <span id="azure-region-error" className="text-[#A4262C]">{fieldErrors.azure_speech_region}</span> : customRegion ? 'Enter the region ID shown in your Azure Speech resource.' : `Preset region · ${REGION_PRESETS.find(([region]) => region === settings.azure_speech_region)?.[1] ?? 'Central India'}.`}
                {regionNeedsSave && !fieldErrors.azure_speech_region && <span> Save settings before refreshing voices.</span>}
              </p>
            </div>
          </div>
        </fieldset>
      )}

      {/* Voice Selection Catalog */}
      <fieldset className="desktop-groupbox shrink-0">
        <legend className="desktop-groupbox-legend">
          {isSapi ? 'SAPI5 Voice Selection' : 'Azure Voice Selection'}
        </legend>
        <div className="desktop-setting-row">
          <span className="desktop-setting-label">Current voice</span>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-xs" title={currentVoice}>
              {currentVoice || (isSapi ? 'default' : 'hi-IN-MadhurNeural')}
            </span>
            {!isSapi && (
              <button type="button" onClick={() => { setCustomVoiceHidden(showCustomVoice); if (!showCustomVoice) setCustomVoice(true); }} className={secondaryButtonClass}>
                {showCustomVoice ? 'Hide custom ID' : 'Edit custom ID…'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadVoiceCatalog(savedRegion || settings.azure_speech_region, settings.tts_provider)}
              disabled={(!isSapi && !keyConfigured) || (!isSapi && regionNeedsSave) || catalogState === 'loading'}
              className={secondaryButtonClass}
              title={isSapi ? 'Refresh installed SAPI voices' : regionNeedsSave ? 'Save settings to load voices for the edited region' : 'Refresh voices from Azure Speech'}
            >
              <RefreshCw className={`h-3 w-3 ${catalogState === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
            <span className="ml-auto text-[11px] text-[#555]">
              {voiceCatalog ? `${voiceCatalog.count} voices · ${localeOptions.length} locales` : ''}
            </span>
          </div>
        </div>

        {!isSapi && showCustomVoice && (
          <div className="desktop-setting-row">
            <label htmlFor="azure-voice-id" className="desktop-setting-label">Custom voice ID</label>
            <input
              id="azure-voice-id"
              type="text"
              value={settings.azure_speech_voice}
              onChange={(event) => {
                const voice = event.target.value;
                setCustomVoice(true);
                setCustomVoiceHidden(false);
                setSettings((previous) => ({ ...previous, azure_speech_voice: voice, azure_speech_voices: voice ? [voice] : [], azure_speech_voice_rotation: false }));
              }}
              placeholder="hi-IN-MadhurNeural"
              className={`${fieldClass} font-mono`}
              aria-describedby="voice-selection-status"
            />
          </div>
        )}
        <p id="voice-selection-status" className="desktop-help-text pl-[132px]">
          {isSapi
            ? catalogState === 'loading'
              ? 'Loading installed Windows voices…'
              : catalogState === 'ready'
                ? `${visibleVoices.length} of ${voiceCatalog?.count ?? 0} SAPI voices available.`
                : 'Refresh to query installed Windows SAPI voices.'
            : regionNeedsSave
              ? `Save to load the ${settings.azure_speech_region || 'edited'} region catalog.`
              : voiceCatalog && !currentVoiceAvailable
                ? `Saved voice is not listed in ${voiceCatalog.region}; it remains available as a custom ID.`
                : catalogState === 'error'
                  ? catalogError
                  : catalogState === 'loading'
                    ? `Loading voices for ${savedRegion || settings.azure_speech_region}…`
                    : catalogState === 'ready'
                      ? `${visibleVoices.length} of ${voiceCatalog?.count ?? 0} voices shown.`
                      : keyConfigured ? 'Refresh to browse the saved region catalog.' : 'Save an Azure Speech key to load the catalog.'}
        </p>

        <div className="desktop-setting-row mt-1">
          <label htmlFor="voice-rotation" className="desktop-setting-label">Voice mode</label>
          <label className="flex min-h-7 items-center gap-2 text-xs">
            <input
              id="voice-rotation"
              type="checkbox"
              checked={isSapi ? settings.sapi_voice_rotation : settings.azure_speech_voice_rotation}
              onChange={(event) => updateField(isSapi ? 'sapi_voice_rotation' : 'azure_speech_voice_rotation', event.target.checked)}
              className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
            />
            Rotate between selected voices, one voice per message
          </label>
        </div>

        {(isSapi ? settings.sapi_voice_rotation : settings.azure_speech_voice_rotation) && (
          <div className="desktop-setting-row items-start">
            <span className="desktop-setting-label pt-1">Rotation order</span>
            <div className="min-w-0">
              {(isSapi ? settings.sapi_voices : settings.azure_speech_voices).length ? (
                <ol className="flex flex-wrap gap-1.5" aria-label="Voice rotation order">
                  {(isSapi ? settings.sapi_voices : settings.azure_speech_voices).map((voice, index) => (
                    <li key={`${voice}-${index}`} className="flex h-7 items-center gap-1 border border-[#C8C8C8] bg-[#F7F7F7] px-1.5 font-mono text-[11px]">
                      <span className="font-sans font-semibold text-[#555]">{index + 1}.</span>
                      <span className="max-w-48 truncate" title={voice}>{voice}</span>
                      <button
                        type="button"
                        onClick={() => moveRotationVoice(voice, -1)}
                        disabled={index === 0}
                        className="desktop-icon-button"
                        aria-label={`Move ${voice} earlier`}
                        title="Move earlier"
                      >
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRotationVoice(voice, 1)}
                        disabled={index === (isSapi ? settings.sapi_voices.length : settings.azure_speech_voices.length) - 1}
                        className="desktop-icon-button"
                        aria-label={`Move ${voice} later`}
                        title="Move later"
                      >
                        <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-xs text-[#A4262C]">Select at least one voice below.</p>}
              <p className="desktop-help-text">The first voice is primary. Rotation advances when synthesis starts, including manual announcements.</p>
            </div>
          </div>
        )}

        <div className="mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,220px)] gap-1.5 max-[420px]:grid-cols-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#666]" aria-hidden="true" />
            <input
              type="search"
              value={voiceSearch}
              onChange={(event) => setVoiceSearch(event.target.value)}
              placeholder="Search voices or languages"
              aria-label="Search voices"
              className={`${fieldClass} pl-7`}
            />
          </div>
          <select value={localeFilter} onChange={(event) => setLocaleFilter(event.target.value)} aria-label="Filter voices by locale" className={fieldClass}>
            <option value="all">All locales</option>
            {localeOptions.map(([locale, name]) => <option key={locale} value={locale}>{name} ({locale})</option>)}
          </select>
        </div>

        <div
          role={(isSapi ? settings.sapi_voice_rotation : settings.azure_speech_voice_rotation) ? 'group' : 'radiogroup'}
          aria-label="Voice list"
          aria-busy={catalogState === 'loading'}
          className="mt-1 min-w-0 max-h-[min(300px,35dvh)] overflow-x-hidden overflow-y-auto border border-[#BDBDBD] bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#555]"
        >
          <div aria-hidden="true" className="sticky top-0 z-10 grid min-h-7 grid-cols-[20px_minmax(0,1fr)_minmax(110px,0.8fr)_60px_64px] items-center gap-2 border-b border-[#BDBDBD] bg-[#F1F1F1] px-2 text-[11px] font-semibold text-[#444] max-[560px]:grid-cols-[20px_minmax(0,1fr)_minmax(0,0.7fr)]">
            <span />
            <span>Voice</span>
            <span>Language</span>
            <span className="max-[560px]:hidden">Gender</span>
            <span className="text-right max-[560px]:hidden">Type</span>
          </div>
          {catalogState === 'loading' && (
            <div className="flex min-h-14 items-center gap-2 px-3 text-xs text-[#555]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading voice list…
            </div>
          )}
          {catalogState === 'ready' && visibleVoices.map((voice) => {
            const rotationEnabled = isSapi ? settings.sapi_voice_rotation : settings.azure_speech_voice_rotation;
            const currentPool = isSapi ? settings.sapi_voices : settings.azure_speech_voices;
            const activeVoice = isSapi ? settings.sapi_voice : settings.azure_speech_voice;
            const selected = rotationEnabled
              ? currentPool.includes(voice.shortName)
              : activeVoice === voice.shortName;
            const control = rotationEnabled ? (
              <input
                type="checkbox"
                checked={selected}
                disabled={(!isSapi && regionNeedsSave) || (selected && currentPool.length === 1)}
                onChange={(event) => toggleRotationVoice(voice.shortName, event.target.checked)}
                aria-label={`${selected ? 'Remove' : 'Add'} ${voice.shortName} ${selected ? 'from' : 'to'} voice rotation`}
                className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
              />
            ) : (
              <input
                type="radio"
                name="speech-voice-option"
                value={voice.shortName}
                checked={selected}
                disabled={!isSapi && regionNeedsSave}
                onChange={() => selectSingleVoice(voice.shortName)}
                aria-label={`Set ${voice.shortName} as the speech voice`}
                className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
              />
            );
            return (
              <label key={voice.shortName} className={`grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_minmax(110px,0.8fr)_60px_64px] items-center gap-2 border-b border-[#E7E7E7] px-2 text-left text-xs last:border-b-0 max-[560px]:grid-cols-[20px_minmax(0,1fr)_minmax(0,0.7fr)] ${selected ? 'bg-[#ECECEC]' : 'hover:bg-[#F6F6F6]'} ${(!isSapi && regionNeedsSave) ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                {control}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[#222]">{voice.displayName || voice.localName || voice.shortName}</span>
                  <span className="block truncate font-mono text-[10px] text-[#666]">{voice.shortName}</span>
                </span>
                <span className="truncate text-[#555]">{voice.localeName || voice.locale}</span>
                <span className="text-[#555] max-[560px]:hidden">{voice.gender || '—'}</span>
                <span className="text-right text-[#666] max-[560px]:hidden">{voice.voiceType || (isSapi ? 'SAPI5' : 'Neural')}</span>
              </label>
            );
          })}
          {catalogState === 'ready' && visibleVoices.length === 0 && (
            <div className="px-3 py-5 text-center text-xs text-[#666]">No voices match this search.</div>
          )}
          {catalogState === 'idle' && (
            <div className="px-3 py-5 text-xs text-[#666]">
              {isSapi
                ? 'Select Refresh to scan installed SAPI voices.'
                : keyConfigured
                  ? 'Select Refresh to load the voice catalog.'
                  : 'Save an Azure Speech key to browse all available voices.'}
            </div>
          )}
          {catalogState === 'error' && (
            <div className="px-3 py-5 text-xs text-[#666]">
              {catalogError || 'The saved voice remains usable. Refresh after correcting the settings.'}
            </div>
          )}
        </div>
      </fieldset>

      {/* YouTube Live Chat */}
      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend">YouTube live chat</legend>
        <div className="desktop-setting-row">
          <span className="desktop-setting-label">Listener</span>
          <label className="flex min-h-7 items-center gap-2 text-xs">
            <input id="youtube-enabled" type="checkbox" checked={settings.enable_youtube} onChange={(event) => updateField('enable_youtube', event.target.checked)} className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]" />
            Enabled
          </label>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="youtube-channel" className="desktop-setting-label">Channel ID</label>
          <div className="min-w-0">
            <input id="youtube-channel" type="text" value={settings.youtube_channel_id} onChange={(event) => updateField('youtube_channel_id', event.target.value)} placeholder="UC…" className={`${fieldClass} font-mono ${fieldErrors.youtube_channel_id ? 'border-[#A4262C]' : ''}`} aria-invalid={Boolean(fieldErrors.youtube_channel_id)} aria-describedby={fieldErrors.youtube_channel_id ? 'youtube-channel-error' : undefined} />
            {fieldErrors.youtube_channel_id && <p id="youtube-channel-error" className="desktop-help-text text-[#A4262C]">{fieldErrors.youtube_channel_id}</p>}
          </div>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="youtube-live-id" className="desktop-setting-label">Live video ID</label>
          <input id="youtube-live-id" type="text" value={settings.youtube_live_id ?? ''} onChange={(event) => updateField('youtube_live_id', event.target.value || null)} placeholder="Blank to detect automatically" className={`${fieldClass} font-mono`} />
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="youtube-chat-mode" className="desktop-setting-label">Chat mode</label>
          <div className="min-w-0">
            <select
              id="youtube-chat-mode"
              value={settings.youtube_chat_mode}
              onChange={(event) => updateField('youtube_chat_mode', event.target.value as 'live' | 'top')}
              className={fieldClass}
            >
              <option value="live">Live chat (All messages - Recommended)</option>
              <option value="top">Top chat (Filtered by YouTube algorithm)</option>
            </select>
            <p className="desktop-help-text">Live chat reads all messages in real time. Top chat only reads highlights filtered by YouTube.</p>
          </div>
        </div>
      </fieldset>

      {/* Facebook Live Chat */}
      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend">Facebook Live Chat (Bring Your Own Token)</legend>
        <div className="desktop-setting-row">
          <span className="desktop-setting-label">Listener</span>
          <label className="flex min-h-7 items-center gap-2 text-xs">
            <input
              id="facebook-enabled"
              type="checkbox"
              checked={settings.enable_facebook}
              onChange={(event) => updateField('enable_facebook', event.target.checked)}
              className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
            />
            Enabled
          </label>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="facebook-token" className="desktop-setting-label">Access token</label>
          <div className="min-w-0">
            <div className="flex gap-1.5">
              <input
                id="facebook-token"
                type={showFacebookToken ? 'text' : 'password'}
                autoComplete="new-password"
                value={settings.facebook_access_token}
                onChange={(event) => updateField('facebook_access_token', event.target.value)}
                placeholder={facebookTokenConfigured ? 'Enter a new token to replace the saved token' : 'Paste User or Page Access Token'}
                className={`${fieldClass} font-mono ${fieldErrors.facebook_access_token ? 'border-[#A4262C]' : ''}`}
                aria-invalid={Boolean(fieldErrors.facebook_access_token)}
                aria-describedby={fieldErrors.facebook_access_token ? 'facebook-token-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowFacebookToken((visible) => !visible)}
                className={secondaryButtonClass}
                title={showFacebookToken ? 'Hide token' : 'Show token'}
                aria-label={showFacebookToken ? 'Hide Facebook token' : 'Show Facebook token'}
              >
                {showFacebookToken ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              {facebookTokenConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setSettings((previous) => ({ ...previous, facebook_access_token: '' }));
                    setClearFacebookToken((requested) => !requested);
                  }}
                  className={secondaryButtonClass}
                  aria-pressed={clearFacebookToken}
                >
                  {clearFacebookToken ? 'Keep token' : 'Clear token'}
                </button>
              )}
              <button
                type="button"
                onClick={handleTestFacebook}
                disabled={testingFacebook || (!facebookTokenConfigured && !settings.facebook_access_token.trim())}
                className={secondaryButtonClass}
                title="Test Facebook connection"
              >
                {testingFacebook ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
                Test
              </button>
              <span className="flex shrink-0 items-center px-1 text-[11px] text-[#555]">
                {facebookTokenConfigured ? 'Saved' : 'Not set'}
              </span>
            </div>
            {fieldErrors.facebook_access_token && (
              <p id="facebook-token-error" className="desktop-help-text text-[#A4262C]">{fieldErrors.facebook_access_token}</p>
            )}
            {facebookTestResult && (
              <p className={`desktop-help-text flex items-center gap-1 ${facebookTestResult.success ? 'text-[#107C41]' : 'text-[#A4262C]'}`}>
                {facebookTestResult.success ? <Check className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
                {facebookTestResult.message}
              </p>
            )}
            <p className="desktop-help-text">
              {clearFacebookToken
                ? 'The saved Facebook token will be removed when you save.'
                : 'Bring Your Own Token (BYOT). Meta User Token with pages_read_engagement or Page Access Token.'}
            </p>
          </div>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="facebook-target-id" className="desktop-setting-label">Target ID</label>
          <div className="min-w-0">
            <input
              id="facebook-target-id"
              type="text"
              value={settings.facebook_target_id}
              onChange={(event) => updateField('facebook_target_id', event.target.value)}
              placeholder="me"
              className={`${fieldClass} font-mono`}
            />
            <p className="desktop-help-text">Use &apos;me&apos; for personal timeline (Professional Mode), or enter your Facebook Page ID.</p>
          </div>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="facebook-live-id" className="desktop-setting-label">Live video ID</label>
          <div className="min-w-0">
            <input
              id="facebook-live-id"
              type="text"
              value={settings.facebook_live_id ?? ''}
              onChange={(event) => updateField('facebook_live_id', event.target.value || null)}
              placeholder="Blank to detect automatically"
              className={`${fieldClass} font-mono`}
            />
            <p className="desktop-help-text">Leave blank to automatically discover the current live broadcast.</p>
          </div>
        </div>
      </fieldset>

      {/* Instagram Live Chat */}
      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend">Instagram Live Chat (Bring Your Own Token)</legend>
        <div className="desktop-setting-row">
          <span className="desktop-setting-label">Listener</span>
          <label className="flex min-h-7 items-center gap-2 text-xs">
            <input
              id="instagram-enabled"
              type="checkbox"
              checked={settings.enable_instagram}
              onChange={(event) => updateField('enable_instagram', event.target.checked)}
              className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
            />
            Enabled
          </label>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="instagram-token" className="desktop-setting-label">Access token</label>
          <div className="min-w-0">
            <div className="flex gap-1.5">
              <input
                id="instagram-token"
                type={showInstagramToken ? 'text' : 'password'}
                autoComplete="new-password"
                value={settings.instagram_access_token}
                onChange={(event) => updateField('instagram_access_token', event.target.value)}
                placeholder={instagramTokenConfigured ? 'Enter a new token to replace the saved token' : 'Paste Instagram User Access Token'}
                className={`${fieldClass} font-mono ${fieldErrors.instagram_access_token ? 'border-[#A4262C]' : ''}`}
                aria-invalid={Boolean(fieldErrors.instagram_access_token)}
                aria-describedby={fieldErrors.instagram_access_token ? 'instagram-token-error' : undefined}
              />
              <button
                type="button"
                onClick={() => setShowInstagramToken((visible) => !visible)}
                className={secondaryButtonClass}
                title={showInstagramToken ? 'Hide token' : 'Show token'}
                aria-label={showInstagramToken ? 'Hide Instagram token' : 'Show Instagram token'}
              >
                {showInstagramToken ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              {instagramTokenConfigured && (
                <button
                  type="button"
                  onClick={() => {
                    setSettings((previous) => ({ ...previous, instagram_access_token: '' }));
                    setClearInstagramToken((requested) => !requested);
                  }}
                  className={secondaryButtonClass}
                  aria-pressed={clearInstagramToken}
                >
                  {clearInstagramToken ? 'Keep token' : 'Clear token'}
                </button>
              )}
              <button
                type="button"
                onClick={handleTestInstagram}
                disabled={testingInstagram || (!instagramTokenConfigured && !settings.instagram_access_token.trim())}
                className={secondaryButtonClass}
                title="Test Instagram connection"
              >
                {testingInstagram ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
                Test
              </button>
              <span className="flex shrink-0 items-center px-1 text-[11px] text-[#555]">
                {instagramTokenConfigured ? 'Saved' : 'Not set'}
              </span>
            </div>
            {fieldErrors.instagram_access_token && (
              <p id="instagram-token-error" className="desktop-help-text text-[#A4262C]">{fieldErrors.instagram_access_token}</p>
            )}
            {instagramTestResult && (
              <p className={`desktop-help-text flex items-center gap-1 ${instagramTestResult.success ? 'text-[#107C41]' : 'text-[#A4262C]'}`}>
                {instagramTestResult.success ? <Check className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
                {instagramTestResult.message}
              </p>
            )}
            <p className="desktop-help-text">
              {clearInstagramToken
                ? 'The saved Instagram token will be removed when you save.'
                : 'Bring Your Own Token (BYOT). Meta User Token with instagram_basic permission.'}
            </p>
          </div>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="instagram-user-id" className="desktop-setting-label">Instagram User ID</label>
          <div className="min-w-0">
            <input
              id="instagram-user-id"
              type="text"
              value={settings.instagram_user_id}
              onChange={(event) => updateField('instagram_user_id', event.target.value)}
              placeholder="e.g. 17841400000000000"
              className={`${fieldClass} font-mono ${fieldErrors.instagram_user_id ? 'border-[#A4262C]' : ''}`}
              aria-invalid={Boolean(fieldErrors.instagram_user_id)}
              aria-describedby={fieldErrors.instagram_user_id ? 'instagram-user-id-error' : undefined}
            />
            {fieldErrors.instagram_user_id && (
              <p id="instagram-user-id-error" className="desktop-help-text text-[#A4262C]">{fieldErrors.instagram_user_id}</p>
            )}
            <p className="desktop-help-text">Your numeric Instagram Professional/Creator account ID.</p>
          </div>
        </div>
        <div className="desktop-setting-row">
          <label htmlFor="instagram-live-id" className="desktop-setting-label">Live media ID</label>
          <div className="min-w-0">
            <input
              id="instagram-live-id"
              type="text"
              value={settings.instagram_live_id ?? ''}
              onChange={(event) => updateField('instagram_live_id', event.target.value || null)}
              placeholder="Blank to detect automatically"
              className={`${fieldClass} font-mono`}
            />
            <p className="desktop-help-text">Leave blank to automatically discover the active Instagram live broadcast.</p>
          </div>
        </div>
      </fieldset>
      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend">Maintenance</legend>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#555]">
          <span className="mr-auto">Local server · 127.0.0.1:{serverPort}</span>
          <button type="button" onClick={handleResetDefaults} className={secondaryButtonClass}><RotateCcw className="h-3 w-3" aria-hidden="true" />Reset defaults</button>
          <button type="button" onClick={onRestart} className={secondaryButtonClass}><RefreshCw className="h-3 w-3" aria-hidden="true" />Restart server</button>
        </div>
      </fieldset>

      {/* Bottom Sticky Action Bar */}
      <div className="sticky bottom-0 -mx-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#C8C8C8] bg-[#F0F0F0] px-2 py-1.5">
        <span className="text-xs text-[#666]">Save to apply settings.</span>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className={`inline-flex h-7 items-center justify-center gap-1 border border-[#333] px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555] disabled:cursor-wait disabled:opacity-60 ${
            justSaved ? 'bg-[#3B3B3B] text-white' : 'bg-[#333] text-white hover:bg-[#1F1F1F]'
          }`}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : justSaved ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
          {saving ? 'Saving…' : justSaved ? 'Saved' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
