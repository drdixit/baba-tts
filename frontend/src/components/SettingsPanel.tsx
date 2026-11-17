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
} from 'lucide-react';

interface AppSettings {
  azure_speech_key: string;
  azure_speech_region: string;
  azure_speech_voice: string;
  azure_speech_voices: string[];
  azure_speech_voice_rotation: boolean;
  youtube_channel_id: string;
  youtube_live_id: string | null;
  enable_youtube: boolean;
}

interface ApiSettings {
  azureSpeechKeyConfigured: boolean;
  azureSpeechRegion: string;
  azureSpeechVoice: string;
  azureSpeechVoices?: string[];
  azureSpeechVoiceRotation?: boolean;
  youtubeChannelId: string;
  youtubeLiveId: string | null;
  enableYoutube: boolean;
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
    azure_speech_key: '',
    azure_speech_region: api.azureSpeechRegion || 'centralindia',
    azure_speech_voice: api.azureSpeechVoice || 'hi-IN-MadhurNeural',
    azure_speech_voices: api.azureSpeechVoices?.length
      ? api.azureSpeechVoices
      : [api.azureSpeechVoice || 'hi-IN-MadhurNeural'],
    azure_speech_voice_rotation: api.azureSpeechVoiceRotation ?? false,
    youtube_channel_id: api.youtubeChannelId || '',
    youtube_live_id: api.youtubeLiveId || null,
    enable_youtube: api.enableYoutube ?? true,
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  azure_speech_key: '',
  azure_speech_region: 'centralindia',
  azure_speech_voice: 'hi-IN-MadhurNeural',
  azure_speech_voices: ['hi-IN-MadhurNeural'],
  azure_speech_voice_rotation: false,
  youtube_channel_id: 'UCiz4lqlVpaB4PpK-1aecMgQ',
  youtube_live_id: null,
  enable_youtube: true,
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

  const loadVoiceCatalog = useCallback(async (region: string) => {
    catalogRequest.current?.abort();
    const controller = new AbortController();
    catalogRequest.current = controller;
    setCatalogState('loading');
    setCatalogError('');

    try {
      const response = await fetch(`/api/voices?region=${encodeURIComponent(region)}`, {
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
        throw new Error('Azure Speech returned an invalid voice list.');
      }

      setVoiceCatalog(result as VoiceCatalog);
      setCatalogState('ready');
      setLocaleFilter('all');
    } catch (error) {
      if (controller.signal.aborted) return;
      setVoiceCatalog(null);
      setCatalogState('error');
      setCatalogError(error instanceof Error ? error.message : 'Could not load Azure voices.');
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
        setSettings(apiToForm(data));
        setSavedRegion(region);
        setCustomRegion(!presetRegionIds.has(region as (typeof REGION_PRESETS)[number][0]));
        setKeyConfigured(data.azureSpeechKeyConfigured);
        if (data.azureSpeechKeyConfigured) void loadVoiceCatalog(region);
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
    if (fieldErrors[field]) {
      setFieldErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  };

  const selectSingleVoice = (voice: string) => {
    setCustomVoice(false);
    setCustomVoiceHidden(false);
    setSettings((previous) => ({
      ...previous,
      azure_speech_voice: voice,
      azure_speech_voices: [voice],
    }));
  };

  const toggleRotationVoice = (voice: string, checked: boolean) => {
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
  };

  const moveRotationVoice = (voice: string, offset: -1 | 1) => {
    setSettings((previous) => {
      const voices = [...previous.azure_speech_voices];
      const index = voices.indexOf(voice);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= voices.length) return previous;
      [voices[index], voices[nextIndex]] = [voices[nextIndex], voices[index]];
      return { ...previous, azure_speech_voice: voices[0], azure_speech_voices: voices };
    });
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
    if (!settings.azure_speech_region.trim()) {
      errors.azure_speech_region = 'Enter your Azure Speech region.';
    }
    if (settings.enable_youtube && !settings.youtube_channel_id.trim()) {
      errors.youtube_channel_id = 'Enter a YouTube channel ID or turn off the listener.';
    }
    if (settings.azure_speech_voice_rotation && settings.azure_speech_voices.length === 0) {
      errors.azure_speech_voices = 'Select at least one voice for rotation.';
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
          azureSpeechKey: settings.azure_speech_key.trim(),
          clearAzureSpeechKey: clearKey,
          azureSpeechRegion: settings.azure_speech_region.trim() || 'centralindia',
          azureSpeechVoice: settings.azure_speech_voice.trim() || 'hi-IN-MadhurNeural',
          azureSpeechVoices: settings.azure_speech_voices.length ? settings.azure_speech_voices : [settings.azure_speech_voice],
          azureSpeechVoiceRotation: settings.azure_speech_voice_rotation,
          youtubeChannelId: settings.youtube_channel_id.trim(),
          youtubeLiveId: settings.youtube_live_id?.trim() || null,
          enableYoutube: settings.enable_youtube,
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
      setSettings((previous) => ({ ...previous, azure_speech_key: '' }));
      setSavedRegion(region);
      setBanner({ type: 'success', message: 'Settings saved and applied.' });
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2200);

      if (hasKey) {
        await loadVoiceCatalog(region);
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
  const currentVoiceAvailable = voiceCatalog?.voices.some(
    (voice) => voice.shortName === settings.azure_speech_voice,
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

      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend">Azure Speech</legend>
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

      <fieldset className="desktop-groupbox shrink-0">
        <legend className="desktop-groupbox-legend">Voice selection</legend>
        <div className="desktop-setting-row">
          <span className="desktop-setting-label">Current voice</span>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-xs" title={settings.azure_speech_voice}>{settings.azure_speech_voice || 'hi-IN-MadhurNeural'}</span>
            <button type="button" onClick={() => { setCustomVoiceHidden(showCustomVoice); if (!showCustomVoice) setCustomVoice(true); }} className={secondaryButtonClass}>{showCustomVoice ? 'Hide custom ID' : 'Edit custom ID…'}</button>
            <button
              type="button"
              onClick={() => void loadVoiceCatalog(savedRegion || settings.azure_speech_region)}
              disabled={!keyConfigured || regionNeedsSave || catalogState === 'loading'}
              className={secondaryButtonClass}
              title={regionNeedsSave ? 'Save settings to load voices for the edited region' : 'Refresh voices from Azure Speech'}
            >
              <RefreshCw className={`h-3 w-3 ${catalogState === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </button>
            <span className="ml-auto text-[11px] text-[#555]">{voiceCatalog ? `${voiceCatalog.count} voices · ${localeOptions.length} locales` : ''}</span>
          </div>
        </div>

        {showCustomVoice && (
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
          {regionNeedsSave
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
              checked={settings.azure_speech_voice_rotation}
              onChange={(event) => updateField('azure_speech_voice_rotation', event.target.checked)}
              className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
            />
            Rotate between selected voices, one voice per message
          </label>
        </div>

        {settings.azure_speech_voice_rotation && (
          <div className="desktop-setting-row items-start">
            <span className="desktop-setting-label pt-1">Rotation order</span>
            <div className="min-w-0">
              {settings.azure_speech_voices.length ? (
                <ol className="flex flex-wrap gap-1.5" aria-label="Voice rotation order">
                  {settings.azure_speech_voices.map((voice, index) => (
                    <li key={`${voice}-${index}`} className="flex h-7 items-center gap-1 border border-[#C8C8C8] bg-[#F7F7F7] px-1.5 font-mono text-[11px]">
                      <span className="font-sans font-semibold text-[#555]">{index + 1}.</span>
                      <span className="max-w-48 truncate" title={voice}>{voice}</span>
                      <button type="button" onClick={() => moveRotationVoice(voice, -1)} disabled={index === 0} className="desktop-icon-button" aria-label={`Move ${voice} earlier`} title="Move earlier"><ArrowUp className="h-3 w-3" aria-hidden="true" /></button>
                      <button type="button" onClick={() => moveRotationVoice(voice, 1)} disabled={index === settings.azure_speech_voices.length - 1} className="desktop-icon-button" aria-label={`Move ${voice} later`} title="Move later"><ArrowDown className="h-3 w-3" aria-hidden="true" /></button>
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
            <input type="search" value={voiceSearch} onChange={(event) => setVoiceSearch(event.target.value)} placeholder="Search voices or languages" aria-label="Search Azure voices" className={`${fieldClass} pl-7`} />
          </div>
          <select value={localeFilter} onChange={(event) => setLocaleFilter(event.target.value)} aria-label="Filter voices by locale" className={fieldClass}>
            <option value="all">All locales</option>
            {localeOptions.map(([locale, name]) => <option key={locale} value={locale}>{name} ({locale})</option>)}
          </select>
        </div>

        <div
          role={settings.azure_speech_voice_rotation ? 'group' : 'radiogroup'}
          aria-label="Azure Speech voices"
          aria-describedby="voice-list-instructions"
          aria-busy={catalogState === 'loading'}
          className="mt-1 min-w-0 max-h-[min(300px,35dvh)] overflow-x-hidden overflow-y-auto border border-[#BDBDBD] bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#555]"
        >
          <p id="voice-list-instructions" className="sr-only">{settings.azure_speech_voice_rotation ? 'Check voices to add them to the rotation. Use the rotation order controls to reorder them.' : 'Use the arrow keys to move between voices and select a single default voice.'}</p>
          <div aria-hidden="true" className="sticky top-0 z-10 grid min-h-7 grid-cols-[20px_minmax(0,1fr)_minmax(110px,0.8fr)_60px_64px] items-center gap-2 border-b border-[#BDBDBD] bg-[#F1F1F1] px-2 text-[11px] font-semibold text-[#444] max-[560px]:grid-cols-[20px_minmax(0,1fr)_minmax(0,0.7fr)]">
            <span />
            <span>Voice</span>
            <span>Language</span>
            <span className="max-[560px]:hidden">Gender</span>
            <span className="text-right max-[560px]:hidden">Type</span>
          </div>
          {catalogState === 'loading' && <div className="flex min-h-14 items-center gap-2 px-3 text-xs text-[#555]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Loading Azure voice list…</div>}
          {catalogState === 'ready' && visibleVoices.map((voice) => {
            const selected = settings.azure_speech_voice_rotation
              ? settings.azure_speech_voices.includes(voice.shortName)
              : settings.azure_speech_voice === voice.shortName;
            const control = settings.azure_speech_voice_rotation ? (
              <input
                type="checkbox"
                checked={selected}
                disabled={regionNeedsSave || (selected && settings.azure_speech_voices.length === 1)}
                onChange={(event) => toggleRotationVoice(voice.shortName, event.target.checked)}
                aria-label={`${selected ? 'Remove' : 'Add'} ${voice.shortName} ${selected ? 'from' : 'to'} voice rotation`}
                className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
              />
            ) : (
              <input
                type="radio"
                name="azure-speech-voice-option"
                value={voice.shortName}
                checked={selected}
                disabled={regionNeedsSave}
                onChange={() => selectSingleVoice(voice.shortName)}
                aria-label={`Set ${voice.shortName} as the speech voice`}
                className="h-3.5 w-3.5 accent-[#555] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
              />
            );
            return (
              <label key={voice.shortName} className={`grid min-h-9 w-full grid-cols-[20px_minmax(0,1fr)_minmax(110px,0.8fr)_60px_64px] items-center gap-2 border-b border-[#E7E7E7] px-2 text-left text-xs last:border-b-0 max-[560px]:grid-cols-[20px_minmax(0,1fr)_minmax(0,0.7fr)] ${selected ? 'bg-[#ECECEC]' : 'hover:bg-[#F6F6F6]'} ${regionNeedsSave ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                {control}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[#222]">{voice.displayName || voice.localName || voice.shortName}</span>
                  <span className="block truncate font-mono text-[10px] text-[#666]">{voice.shortName}</span>
                </span>
                <span className="truncate text-[#555]">{voice.localeName || voice.locale}</span>
                <span className="text-[#555] max-[560px]:hidden">{voice.gender || '—'}</span>
                <span className="text-right text-[#666] max-[560px]:hidden">{voice.voiceType || 'Neural'}</span>
              </label>
            );
          })}
          {catalogState === 'ready' && visibleVoices.length === 0 && <div className="px-3 py-5 text-center text-xs text-[#666]">No voices match this search.</div>}
          {catalogState === 'idle' && <div className="px-3 py-5 text-xs text-[#666]">{keyConfigured ? 'Select Refresh to load the voice catalog.' : 'Save an Azure Speech key to browse all available voices.'}</div>}
          {catalogState === 'error' && <div className="px-3 py-5 text-xs text-[#666]">{catalogError || 'The saved voice remains usable. Refresh after correcting the Azure settings.'}</div>}
        </div>
      </fieldset>

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
      </fieldset>

      <fieldset className="desktop-groupbox">
        <legend className="desktop-groupbox-legend">Maintenance</legend>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#555]">
          <span className="mr-auto">Local server · 127.0.0.1:{serverPort}</span>
          <button type="button" onClick={handleResetDefaults} className={secondaryButtonClass}><RotateCcw className="h-3 w-3" aria-hidden="true" />Reset defaults</button>
          <button type="button" onClick={onRestart} className={secondaryButtonClass}><RefreshCw className="h-3 w-3" aria-hidden="true" />Restart server</button>
        </div>
      </fieldset>

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
