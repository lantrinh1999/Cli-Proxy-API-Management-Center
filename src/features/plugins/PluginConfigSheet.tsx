import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Sheet } from '@/components/ui/Sheet';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { pluginsApi } from '@/services/api';
import { useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type { PluginConfigField, PluginListEntry, PluginListResponse } from '@/types';
import {
  buildPluginConfigDraft,
  buildPluginConfigPatch,
  normalizePluginConfigFieldType,
  type PluginConfigDraft,
} from './pluginConfigDraft';
import { getPluginTitle, notifyPluginResourcesChanged } from './pluginResources';
import { waitForPluginState } from './pluginPolling';
import { PluginModelsEditor } from './PluginModelsEditor';
import { applyChRelayVipProErrors } from './vipProConfigValidation';
import styles from './PluginsPage.module.scss';

type PluginRuntimeWaitStatus = 'ready' | 'globalDisabled' | 'timeout';

export type PluginConfigActivity = 'loading' | 'saving';

interface ConfigSession {
  id: string;
  draft: PluginConfigDraft;
}

interface PluginConfigSheetProps {
  plugin: PluginListEntry | null;
  onClose: () => void;
  onActivityChange?: (activity: PluginConfigActivity | null) => void;
  onSaved?: (list: PluginListResponse) => void;
}

const hasStatus = (error: unknown, status: number) => isRecord(error) && error.status === status;

export function PluginConfigSheet({
  plugin,
  onClose,
  onActivityChange,
  onSaved,
}: PluginConfigSheetProps) {
  const { t } = useTranslation();
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [session, setSession] = useState<ConfigSession | null>(null);
  const [saving, setSaving] = useState(false);
  const requestSeq = useRef(0);
  const onCloseRef = useRef(onClose);
  const onActivityChangeRef = useRef(onActivityChange);
  const onSavedRef = useRef(onSaved);
  const showNotificationRef = useRef(showNotification);
  const tRef = useRef(t);
  const pluginId = plugin?.id ?? '';
  const pluginRef = useRef(plugin);

  useEffect(() => {
    onCloseRef.current = onClose;
    onActivityChangeRef.current = onActivityChange;
    onSavedRef.current = onSaved;
    showNotificationRef.current = showNotification;
    tRef.current = t;
    pluginRef.current = plugin;
  });

  const draft = session && plugin && session.id === plugin.id ? session.draft : null;

  useEffect(() => {
    const current = pluginRef.current;
    if (!current) {
      requestSeq.current += 1;
      setSession(null);
      onActivityChangeRef.current?.(null);
      return;
    }

    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    let cancelled = false;
    onActivityChangeRef.current?.('loading');

    pluginsApi.getConfig(current.id).then(
      (currentConfig) => {
        if (cancelled || requestSeq.current !== seq) return;
        const loaded = buildPluginConfigDraft(current, currentConfig);
        setSession({
          id: current.id,
          draft:
            current.id === 'ch-relay-vippro'
              ? applyChRelayVipProErrors(loaded, tRef.current)
              : loaded,
        });
        onActivityChangeRef.current?.(null);
      },
      (err: unknown) => {
        if (cancelled || requestSeq.current !== seq) return;
        setSession(null);
        onActivityChangeRef.current?.(null);
        showNotificationRef.current(
          hasStatus(err, 404)
            ? tRef.current('plugin_management.config_not_found')
            : `${tRef.current('plugin_management.config_load_failed')}: ${getErrorMessage(
                err,
                tRef.current('plugin_management.config_load_failed')
              )}`,
          'error'
        );
        onCloseRef.current();
      }
    );
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  const updateDraft = (updater: (current: PluginConfigDraft) => PluginConfigDraft) => {
    setSession((current) => {
      if (!current || current.id !== plugin?.id) return current;
      const next = updater(current.draft);
      return {
        ...current,
        draft: plugin?.id === 'ch-relay-vippro' ? applyChRelayVipProErrors(next, t) : next,
      };
    });
  };

  const handleFieldTextChange =
    (fieldName: string) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      updateDraft((current) => ({
        ...current,
        values: { ...current.values, [fieldName]: value },
        errors: { ...current.errors, [fieldName]: '' },
        touchedFields: { ...current.touchedFields, [fieldName]: true },
      }));
    };

  const handleFieldBooleanChange = (fieldName: string, value: boolean) => {
    updateDraft((current) => ({
      ...current,
      values: { ...current.values, [fieldName]: value },
      errors: { ...current.errors, [fieldName]: '' },
      touchedFields: { ...current.touchedFields, [fieldName]: true },
    }));
  };

  const handlePriorityChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateDraft((current) => ({
      ...current,
      priority: value,
      errors: { ...current.errors, priority: '' },
      priorityTouched: true,
    }));
  };

  const handleSaveConfig = async () => {
    if (!plugin || !draft || saving) return;
    const { patch, errors } = buildPluginConfigPatch(draft, plugin.configFields, t);
    const vipProErrors =
      plugin.id === 'ch-relay-vippro' ? applyChRelayVipProErrors(draft, t).errors : {};
    const merged = { ...errors, ...vipProErrors };
    const blocked = Object.values(merged).some((item) => item);

    if (blocked) {
      updateDraft((current) => ({ ...current, errors: merged }));
      showNotification(t('plugin_management.validation_failed'), 'warning');
      return;
    }

    if (Object.keys(patch).length === 0) {
      setSession(null);
      showNotification(t('plugin_management.save_success'), 'success');
      onClose();
      return;
    }

    setSaving(true);
    onActivityChange?.('saving');
    try {
      await pluginsApi.patchConfig(plugin.id, patch);
      clearConfigCache();
      const enabledChanged = typeof patch.enabled === 'boolean' && patch.enabled !== plugin.enabled;
      let status: PluginRuntimeWaitStatus = 'ready';
      let nextList: PluginListResponse | null = null;
      try {
        if (enabledChanged) {
          const result = await waitForPluginState(plugin.id, (item, response) =>
            patch.enabled === true
              ? !response.pluginsEnabled || (item.registered && item.effectiveEnabled)
              : !item.effectiveEnabled
          );
          nextList = result.response;
          status =
            patch.enabled === true && !result.response.pluginsEnabled
              ? 'globalDisabled'
              : result.timedOut
                ? 'timeout'
                : 'ready';
        } else {
          nextList = await pluginsApi.list();
        }
      } catch {
        status = 'ready';
      }
      if (status === 'ready') notifyPluginResourcesChanged();
      if (nextList) onSavedRef.current?.(nextList);
      setSession(null);
      if (status === 'ready') {
        showNotification(t('plugin_management.save_success'), 'success');
      } else {
        showNotification(
          t(
            status === 'globalDisabled'
              ? 'plugin_management.global_disabled_hint'
              : 'plugin_management.runtime_pending'
          ),
          'warning'
        );
      }
      onClose();
    } catch (err: unknown) {
      showNotification(
        `${t('plugin_management.save_failed')}: ${getErrorMessage(
          err,
          t('plugin_management.save_failed')
        )}`,
        'error'
      );
    } finally {
      setSaving(false);
      onActivityChange?.(null);
    }
  };

  const fieldCopy = (field: PluginConfigField) => {
    const fallback = { label: field.name, hint: field.description };
    if (plugin?.id !== 'ch-relay-vippro') return fallback;
    const base = `plugin_management.ch_relay_vippro.fields.${field.name}`;
    return {
      label: t(`${base}.label`, { defaultValue: field.name }),
      hint: t(`${base}.hint`, { defaultValue: field.description || '' }),
    };
  };

  const optionLabel = (field: PluginConfigField, value: string) => {
    if (plugin?.id !== 'ch-relay-vippro') return value;
    return t(`plugin_management.ch_relay_vippro.fields.${field.name}.options.${value}`, {
      defaultValue: value,
    });
  };

  const renderFieldEditor = (field: PluginConfigField) => {
    if (!draft || !plugin) return null;
    const fieldType = normalizePluginConfigFieldType(field);
    const value = draft.values[field.name];
    const textValue = typeof value === 'string' ? value : '';
    const errorText = draft.errors[field.name];
    const copy = fieldCopy(field);

    if (fieldType === 'boolean') {
      return (
        <div key={field.name} className={styles.fieldRow}>
          <div className={styles.fieldText}>
            <div className={styles.fieldLabel}>{copy.label}</div>
            {copy.hint ? <div className={styles.fieldDescription}>{copy.hint}</div> : null}
          </div>
          <ToggleSwitch
            checked={value === true}
            onChange={(nextValue) => handleFieldBooleanChange(field.name, nextValue)}
            ariaLabel={field.name}
          />
        </div>
      );
    }

    if (fieldType === 'enum' && field.enumValues.length > 0) {
      return (
        <div key={field.name} className={styles.formField}>
          <label htmlFor={`plugin-field-${field.name}`}>{copy.label}</label>
          <Select
            id={`plugin-field-${field.name}`}
            value={textValue}
            options={field.enumValues.map((item) => ({ value: item, label: optionLabel(field, item) }))}
            onChange={(nextValue) =>
              updateDraft((current) => ({
                ...current,
                values: { ...current.values, [field.name]: nextValue },
                errors: { ...current.errors, [field.name]: '' },
                touchedFields: { ...current.touchedFields, [field.name]: true },
              }))
            }
            placeholder={t('plugin_management.select_placeholder')}
          />
          {copy.hint ? <div className={styles.fieldHint}>{copy.hint}</div> : null}
          {errorText ? <div className={styles.fieldError}>{errorText}</div> : null}
        </div>
      );
    }

    if (plugin.id === 'ch-relay-vippro' && field.name === 'models') {
      return (
        <PluginModelsEditor
          key={field.name}
          value={textValue}
          baseUrl={typeof draft.values['base-url'] === 'string' ? draft.values['base-url'] : ''}
          disabled={saving}
          onChange={(nextValue) =>
            updateDraft((current) => ({
              ...current,
              values: { ...current.values, [field.name]: nextValue },
              errors: { ...current.errors, [field.name]: '' },
              touchedFields: { ...current.touchedFields, [field.name]: true },
            }))
          }
        />
      );
    }

    if (fieldType === 'array' || fieldType === 'object') {
      return (
        <div key={field.name} className={styles.formField}>
          <label htmlFor={`plugin-field-${field.name}`}>{copy.label}</label>
          <textarea
            id={`plugin-field-${field.name}`}
            className={styles.textarea}
            value={textValue}
            onChange={handleFieldTextChange(field.name)}
            placeholder={fieldType === 'array' ? '[]' : '{}'}
            spellCheck={false}
          />
          {copy.hint ? <div className={styles.fieldHint}>{copy.hint}</div> : null}
          {errorText ? <div className={styles.fieldError}>{errorText}</div> : null}
        </div>
      );
    }

    return (
      <Input
        key={field.name}
        id={`plugin-field-${field.name}`}
        label={copy.label}
        value={textValue}
        onChange={handleFieldTextChange(field.name)}
        inputMode={fieldType === 'integer' || fieldType === 'number' ? 'decimal' : undefined}
        hint={copy.hint || undefined}
        error={errorText || undefined}
      />
    );
  };

  const close = () => {
    if (saving) return;
    onClose();
  };

  return (
    <Sheet
      open={Boolean(plugin && draft)}
      onClose={close}
      size="lg"
      title={
        plugin
          ? t('plugin_management.config_title', { name: getPluginTitle(plugin) })
          : t('plugin_management.edit_config')
      }
      description={plugin?.id}
      closeDisabled={saving}
      footer={
        <div className={styles.sheetFooter}>
          <Button variant="secondary" onClick={close} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSaveConfig()} loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      {draft && plugin ? (
        <div className={styles.configForm}>
          <section className={styles.formSection}>
            <h3>{t('plugin_management.base_settings')}</h3>
            <div className={styles.fieldRow}>
              <div className={styles.fieldText}>
                <div className={styles.fieldLabel}>{t('plugin_management.enabled')}</div>
                <div className={styles.fieldDescription}>{t('plugin_management.enabled_hint')}</div>
              </div>
              <ToggleSwitch
                checked={draft.enabled}
                onChange={(enabled) =>
                  updateDraft((current) => ({
                    ...current,
                    enabled,
                    enabledTouched: true,
                  }))
                }
                ariaLabel={t('plugin_management.enabled')}
              />
            </div>
            <Input
              label={t('plugin_management.priority')}
              value={draft.priority}
              onChange={handlePriorityChange}
              inputMode="numeric"
              error={draft.errors.priority || undefined}
            />
          </section>
          <section className={styles.formSection}>
            <h3>{t('plugin_management.config_fields')}</h3>
            {plugin.configFields.length > 0 ? (
              plugin.configFields.map((field) => renderFieldEditor(field))
            ) : (
              <div className={styles.emptyConfig}>{t('plugin_management.no_config_fields')}</div>
            )}
          </section>
        </div>
      ) : null}
    </Sheet>
  );
}
