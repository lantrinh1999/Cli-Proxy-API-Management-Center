import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { IconDownload } from '@/components/ui/icons';
import { ModelDiscoveryPanel } from '@/features/providers/sheets/forms/ModelDiscoveryPanel';
import { ModelEntriesEditor } from '@/features/providers/sheets/forms/ModelEntriesEditor';
import formStyles from '@/features/providers/sheets/forms/sharedForm.module.scss';
import { mergeDiscoveredModels } from '@/features/providers/modelEntries';
import type { ModelEntryInput } from '@/features/providers/types';
import { authFilesApi, modelsApi } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { getErrorMessage } from '@/utils/helpers';
import type { ModelInfo } from '@/utils/models';
import {
  applyPluginModelsValue,
  initialPluginModelsSync,
  modelsForEditorValue,
  serializePluginModels,
  type PluginModelsSyncState,
} from './pluginModels';

const DEFAULT_BASE_URL = 'https://7656b154.linhtd.com/v1';

const planType = (file: AuthFileItem) =>
  String(file.plan_type ?? file.planType ?? '').trim().toLowerCase();

const isCodex = (file: AuthFileItem) => {
  const type = String(file.type ?? file.provider ?? '').trim().toLowerCase();
  return type === 'codex' && !file.disabled && !file.unavailable && String(file.authIndex ?? '').trim();
};

async function pickCodexAuthIndex() {
  const listed = await authFilesApi.list();
  const codex = listed.files.filter(isCodex);
  const plus = codex.find((file) => planType(file) === 'plus');
  const chosen = plus ?? codex[0];
  return chosen ? String(chosen.authIndex) : '';
}

interface PluginModelsEditorProps {
  value: string;
  baseUrl: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function PluginModelsEditor({ value, baseUrl, disabled, onChange }: PluginModelsEditorProps) {
  const { t } = useTranslation();
  const syncRef = useRef<PluginModelsSyncState>(initialPluginModelsSync(value));
  const [models, setModels] = useState<ModelEntryInput[]>(() => modelsForEditorValue(value));
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<ModelInfo[]>([]);
  const [hasFetched, setHasFetched] = useState(false);

  const existingNames = useMemo(() => {
    const names = new Set<string>();
    models.forEach((model) => {
      const name = model.name.trim();
      if (name) names.add(name);
    });
    return names;
  }, [models]);

  useEffect(() => {
    const next = applyPluginModelsValue(syncRef.current, value);
    if (next === syncRef.current) return;
    syncRef.current = next;
    setModels(next.models);
  }, [value]);

  const commit = (next: ModelEntryInput[]) => {
    const rows = next.length ? next : [{ name: '', alias: '' }];
    const serialized = JSON.stringify(serializePluginModels(rows), null, 2);
    syncRef.current = { models: rows, dirty: true, seenValue: serialized };
    setModels(rows);
    onChange(serialized);
  };

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = baseUrl.trim() || DEFAULT_BASE_URL;
      const authIndex = await pickCodexAuthIndex();
      const next = await modelsApi.fetchModelsViaApiCall(
        endpoint,
        undefined,
        {},
        authIndex || undefined
      );
      setDiscovered(next ?? []);
      setHasFetched(true);
    } catch (err) {
      setDiscovered([]);
      setError(getErrorMessage(err) || t('providersPage.discovery.empty'));
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  };

  const openDiscovery = () => {
    setDiscoveryOpen(true);
    if (!loading && !hasFetched) void fetchModels();
  };

  return (
    <Collapsible
      label={t('providersPage.form.modelsSection')}
      hint={`${existingNames.size}`}
      defaultOpen
    >
      <div className={formStyles.entriesList}>
        <p className={formStyles.labelHint}>{t('plugin_management.ch_relay_vippro.fields.models.hint')}</p>
        <div className={formStyles.entriesToolbar}>
          <button
            type="button"
            className={formStyles.connectivityBtn}
            onClick={openDiscovery}
            disabled={disabled}
          >
            <IconDownload size={14} />
            <span>{t('providersPage.discovery.openButton')}</span>
          </button>
        </div>
        {discoveryOpen ? (
          <ModelDiscoveryPanel
            loading={loading}
            error={error}
            models={discovered}
            hasFetched={hasFetched}
            existingNames={existingNames}
            mutating={disabled}
            onApply={(picked) => commit(mergeDiscoveredModels(models, picked))}
            onReload={() => void fetchModels()}
            onClose={() => setDiscoveryOpen(false)}
          />
        ) : null}
        <ModelEntriesEditor
          providerBrand="openaiCompatibility"
          models={models}
          supportsImage
          supportsThinking
          showFallback
          mutating={disabled}
          removeDisabled={models.length <= 1}
          onUpdate={(idx, patch) => commit(models.map((row, i) => (i === idx ? { ...row, ...patch } : row)))}
          onAdd={() => commit([...models, { name: '', alias: '' }])}
          onRemove={(idx) => commit(models.filter((_, i) => i !== idx))}
        />
      </div>
    </Collapsible>
  );
}
