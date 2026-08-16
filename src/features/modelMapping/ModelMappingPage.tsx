import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconX } from '@/components/ui/icons';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthStore, useModelsStore, useNotificationStore } from '@/stores';
import { isModelMappingUnsupported, modelMappingApi } from '@/services/api/modelMapping';
import type { ModelMappingMode, ModelMappingRule } from '@/types/modelMapping';
import { generateId, getErrorMessage } from '@/utils/helpers';
import { classifyModels } from '@/utils/models';
import { GroupedModelSelect } from './GroupedModelSelect';
import styles from './ModelMappingPage.module.scss';

type DraftRule = ModelMappingRule & { id: string };

const MODE_OPTIONS: ModelMappingMode[] = ['exact', 'wildcard', 'regex'];

const signatureOf = (rules: Array<Omit<DraftRule, 'id'>>): string =>
  JSON.stringify(
    rules.map((rule) => ({
      match: rule.match.trim(),
      target: rule.target.trim(),
      mode: rule.mode,
      enabled: rule.enabled,
      forceMapping: rule.forceMapping,
    }))
  );

const createEmptyRule = (): DraftRule => ({
  id: generateId(),
  match: '',
  target: '',
  mode: 'exact',
  enabled: true,
  forceMapping: true,
});

const inferModeFromMatch = (match: string, current: ModelMappingMode): ModelMappingMode => {
  if (current === 'regex') return current;
  return match.includes('*') ? 'wildcard' : 'exact';
};

export function ModelMappingPage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModels = useModelsStore((state) => state.fetchModels);
  const resolveApiKeysForModels = useApiKeysForModels();
  const disableControls = connectionStatus !== 'connected';

  const [initialLoading, setInitialLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState<ModelMappingRule[]>([]);
  const [rules, setRules] = useState<DraftRule[]>([createEmptyRule()]);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const modelGroups = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);

  const loadCatalog = useCallback(async () => {
    if (connectionStatus !== 'connected' || !apiBase) return;
    try {
      const apiKeys = await resolveApiKeysForModels();
      await fetchModels(apiBase, apiKeys[0]);
    } catch {
      // Keep the page usable with a free-text fallback when the catalog is unavailable.
    }
  }, [apiBase, connectionStatus, fetchModels, resolveApiKeysForModels]);

  const loadRules = useCallback(async () => {
    setInitialLoading(true);
    setLoadError(null);
    setUnsupported(false);
    try {
      const [next] = await Promise.all([modelMappingApi.list(), loadCatalog()]);
      setBaseline(next);
      setRules(next.length ? next.map((rule) => ({ ...rule, id: generateId() })) : [createEmptyRule()]);
    } catch (err) {
      if (isModelMappingUnsupported(err)) {
        setUnsupported(true);
        setBaseline([]);
        setRules([createEmptyRule()]);
        return;
      }
      setLoadError(getErrorMessage(err, t('notification.refresh_failed')));
    } finally {
      setInitialLoading(false);
    }
  }, [loadCatalog, t]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const draftForCompare = useMemo(
    () =>
      rules
        .map((rule) => ({
          match: rule.match.trim(),
          target: rule.target.trim(),
          mode: rule.mode,
          enabled: rule.enabled,
          forceMapping: rule.forceMapping,
        }))
        .filter((rule) => rule.match || rule.target),
    [rules]
  );
  const isDirty = signatureOf(baseline) !== signatureOf(draftForCompare);
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
    }),
    [t]
  );
  useUnsavedChangesGuard({
    shouldBlock: isDirty,
    dialog: unsavedChangesDialog,
  });

  const validRules = useMemo(
    () =>
      rules
        .filter((rule) => rule.match.trim() && rule.target.trim())
        .map(({ id: _id, ...rule }) => rule),
    [rules]
  );
  const hasIncompleteRule = rules.some((rule) => {
    const match = rule.match.trim();
    const target = rule.target.trim();
    return Boolean(match) !== Boolean(target);
  });
  const canSave = !disableControls && !saving && !unsupported && isDirty && !hasIncompleteRule;

  const updateRule = <K extends keyof ModelMappingRule>(
    index: number,
    key: K,
    value: ModelMappingRule[K]
  ) => {
    setRules((current) =>
      current.map((rule, ruleIndex) => {
        if (ruleIndex !== index) return rule;
        if (key === 'match' && typeof value === 'string') {
          return { ...rule, match: value, mode: inferModeFromMatch(value, rule.mode) };
        }
        return { ...rule, [key]: value };
      })
    );
  };

  const addRule = () => {
    setRules((current) => [...current, createEmptyRule()]);
  };

  const removeRule = (index: number) => {
    setRules((current) =>
      current.length <= 1 ? [createEmptyRule()] : current.filter((_, i) => i !== index)
    );
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await modelMappingApi.replace(validRules);
      setBaseline(validRules);
      setRules(validRules.map((rule) => ({ ...rule, id: generateId() })));
      showNotification(t('model_mapping.saved'), 'success');
    } catch (err) {
      if (isModelMappingUnsupported(err)) {
        setUnsupported(true);
        showNotification(t('model_mapping.upgrade_required_desc'), 'error');
        return;
      }
      showNotification(getErrorMessage(err, t('model_mapping.save_failed')), 'error');
    } finally {
      setSaving(false);
    }
  };

  const modeOptions = MODE_OPTIONS.map((mode) => ({
    value: mode,
    label: t(`model_mapping.mode_${mode}`),
  }));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('model_mapping.title')}</h1>
          <p className={styles.subtitle}>{t('model_mapping.subtitle')}</p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => void loadRules()} disabled={saving}>
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={() => void handleSave()} loading={saving} disabled={!canSave}>
            {t('model_mapping.save')}
          </Button>
        </div>
      </div>

      {unsupported ? (
        <Card>
          <EmptyState
            title={t('model_mapping.upgrade_required_title')}
            description={t('model_mapping.upgrade_required_desc')}
          />
        </Card>
      ) : loadError ? (
        <Card>
          <EmptyState
            title={t('notification.refresh_failed')}
            description={loadError}
            action={
              <Button variant="secondary" size="sm" onClick={() => void loadRules()}>
                {t('common.refresh')}
              </Button>
            }
          />
        </Card>
      ) : initialLoading ? (
        <Card>
          <EmptyState title={t('common.loading')} description={t('model_mapping.loading_desc')} />
        </Card>
      ) : (
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            <div>
              <div className={styles.toolbarTitle}>{t('model_mapping.rules_title')}</div>
              <div className={styles.toolbarHint}>
                {modelsLoading
                  ? t('model_mapping.catalog_loading')
                  : t('model_mapping.catalog_count', { count: models.length })}
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={addRule} disabled={disableControls || saving}>
              {t('model_mapping.add_rule')}
            </Button>
          </div>

          {rules.map((rule, index) => (
            <Card key={rule.id} className={styles.ruleCard}>
              <div className={styles.ruleTop}>
                <span className={styles.ruleIndex}>{index + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRule(index)}
                  disabled={disableControls || saving || (rules.length <= 1 && !rule.match && !rule.target)}
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                >
                  <IconX size={14} />
                </Button>
              </div>

              <div className={styles.ruleGrid}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t('model_mapping.match_label')}</span>
                  <input
                    className={`input ${styles.mappingAliasInput}`}
                    placeholder={t('model_mapping.match_placeholder')}
                    value={rule.match}
                    onChange={(event) => updateRule(index, 'match', event.target.value)}
                    disabled={disableControls || saving}
                  />
                </label>
                <div className={styles.arrow} aria-hidden>
                  →
                </div>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>{t('model_mapping.target_label')}</span>
                  <GroupedModelSelect
                    value={rule.target}
                    onChange={(next) => updateRule(index, 'target', next)}
                    groups={modelGroups}
                    placeholder={t('model_mapping.target_placeholder')}
                    searchPlaceholder={t('model_mapping.target_search')}
                    emptyLabel={t('model_mapping.target_empty')}
                    customLabel={t('model_mapping.target_custom')}
                    disabled={disableControls || saving}
                    ariaLabel={t('model_mapping.target_label')}
                  />
                </label>
              </div>

              <div className={styles.ruleMeta}>
                <div className={styles.modeField}>
                  <Select
                    value={rule.mode}
                    options={modeOptions}
                    onChange={(value) => updateRule(index, 'mode', value as ModelMappingMode)}
                    disabled={disableControls || saving}
                    ariaLabel={t('model_mapping.mode_label')}
                    size="sm"
                    fullWidth
                  />
                </div>
                <ToggleSwitch
                  label={t('model_mapping.enabled_label')}
                  labelPosition="left"
                  checked={rule.enabled}
                  onChange={(value) => updateRule(index, 'enabled', value)}
                  disabled={disableControls || saving}
                />
                <ToggleSwitch
                  label={t('model_mapping.force_mapping_label')}
                  labelPosition="left"
                  checked={rule.forceMapping}
                  onChange={(value) => updateRule(index, 'forceMapping', value)}
                  disabled={disableControls || saving}
                />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
