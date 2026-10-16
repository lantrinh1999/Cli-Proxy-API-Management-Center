import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconGithub,
  IconPlug,
  IconRefreshCw,
  IconSearch,
  IconSettings,
  IconSidebarStore,
  IconTrash2,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { pluginsApi, pluginStoreApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type { PluginListEntry, PluginListResponse, PluginStoreEntry } from '@/types';
import { getPluginTitle, notifyPluginResourcesChanged, resolvePluginAssetURL } from './pluginResources';
import { waitForPluginState } from './pluginPolling';
import { getPluginLogo } from './pluginLogo';
import { PluginConfigSheet, type PluginConfigActivity } from './PluginConfigSheet';
import styles from './PluginsPage.module.scss';

type PluginRuntimeWaitStatus = 'ready' | 'globalDisabled' | 'timeout';

function PluginCardLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return showImage ? (
    <img src={src} alt="" onError={() => setFailed(true)} />
  ) : (
    <IconPlug size={18} />
  );
}

const hasStatus = (error: unknown, status: number) => isRecord(error) && error.status === status;

const hasRestartRequired = (value: unknown) => isRecord(value) && value.restart_required === true;

const hasRestartRequiredError = (error: unknown) =>
  isRecord(error) && (hasRestartRequired(error.details) || hasRestartRequired(error.data));

export function PluginsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [data, setData] = useState<PluginListResponse | null>(null);
  const [storeLogos, setStoreLogos] = useState<{
    apiBase: string;
    managementKey: string;
    entries: PluginStoreEntry[];
  } | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingPlugin, setEditingPlugin] = useState<PluginListEntry | null>(null);
  const [configActivity, setConfigActivity] = useState<PluginConfigActivity | null>(null);
  const [mutatingID, setMutatingID] = useState('');
  const [deletingID, setDeletingID] = useState('');

  const connected = connectionStatus === 'connected';

  const loadPlugins = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      setError(t('notification.connection_required'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const plugins = await pluginsApi.list();
      setData(plugins);
    } catch (err: unknown) {
      setError(
        hasStatus(err, 404)
          ? t('plugin_management.unsupported_backend')
          : getErrorMessage(err, t('plugin_management.load_failed'))
      );
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  const waitForPluginRuntimeState = useCallback(
    async (id: string, enabled: boolean): Promise<PluginRuntimeWaitStatus> => {
      const result = await waitForPluginState(id, (item, response) =>
        enabled
          ? !response.pluginsEnabled || (item.registered && item.effectiveEnabled)
          : !item.effectiveEnabled
      );
      setData(result.response);
      if (enabled && !result.response.pluginsEnabled) {
        return 'globalDisabled';
      }
      return result.timedOut ? 'timeout' : 'ready';
    },
    []
  );

  useHeaderRefresh(loadPlugins, connected);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  useEffect(() => {
    setStoreLogos(null);
    if (!connected || !data) return;
    let cancelled = false;
    void pluginStoreApi.list().then(
      (response) => {
        if (!cancelled) {
          setStoreLogos({ apiBase, managementKey, entries: response.plugins });
        }
      },
      () => {
        // Store metadata is optional; its failure must not block plugin management.
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connected, apiBase, managementKey, data]);

  const logoEntries =
    connected && storeLogos?.apiBase === apiBase && storeLogos.managementKey === managementKey
      ? storeLogos.entries
      : [];

  const pluginStats = useMemo(() => {
    const plugins = data?.plugins ?? [];
    return {
      discovered: plugins.length,
      registered: plugins.filter((plugin) => plugin.registered).length,
      configured: plugins.filter((plugin) => plugin.configured).length,
      effective: plugins.filter((plugin) => plugin.effectiveEnabled).length,
    };
  }, [data?.plugins]);

  const visiblePlugins = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const plugins = data?.plugins ?? [];
    if (!query) return plugins;

    return plugins.filter((plugin) => {
      const haystack = [
        plugin.id,
        plugin.path,
        plugin.metadata?.name,
        plugin.metadata?.author,
        plugin.metadata?.version,
        plugin.metadata?.githubRepository,
        ...plugin.menus.map((menu) => `${menu.menu} ${menu.path} ${menu.description}`),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [data?.plugins, filter]);

  const resolvePluginAsset = useCallback(
    (value: string) => resolvePluginAssetURL(value, apiBase),
    [apiBase]
  );

  const openConfig = (plugin: PluginListEntry) => {
    if (configActivity || mutatingID || deletingID) return;
    setEditingPlugin(plugin);
  };

  const handleTogglePlugin = async (plugin: PluginListEntry, enabled: boolean) => {
    if (deletingID || configActivity) return;
    setMutatingID(plugin.id);
    try {
      await pluginsApi.updateEnabled(plugin.id, enabled);
      clearConfigCache();
      const status = await waitForPluginRuntimeState(plugin.id, enabled);
      if (status === 'ready') {
        notifyPluginResourcesChanged();
        showNotification(t('plugin_management.toggle_success'), 'success');
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
    } catch (err: unknown) {
      showNotification(
        `${t('plugin_management.toggle_failed')}: ${getErrorMessage(
          err,
          t('plugin_management.toggle_failed')
        )}`,
        'error'
      );
    } finally {
      setMutatingID('');
    }
  };

  const handleDeletePlugin = (plugin: PluginListEntry) => {
    if (!connected || mutatingID || configActivity || deletingID) return;

    const name = getPluginTitle(plugin);
    showConfirmation({
      title: t('plugin_management.delete_confirm_title'),
      message: t('plugin_management.delete_confirm_message', { name, id: plugin.id }),
      variant: 'danger',
      confirmText: t('plugin_management.delete_plugin'),
      onConfirm: async () => {
        setDeletingID(plugin.id);
        setMutatingID(plugin.id);
        try {
          const result = await pluginsApi.deletePlugin(plugin.id);
          clearConfigCache();
          if (editingPlugin?.id === plugin.id) {
            setEditingPlugin(null);
          }
          await loadPlugins();
          notifyPluginResourcesChanged();
          showNotification(t('plugin_management.delete_success'), 'success');
          if (result.restartRequired) {
            showNotification(t('plugin_management.delete_restart_required'), 'warning');
          }
        } catch (err: unknown) {
          const restartRequired = hasRestartRequiredError(err);
          const fallback = restartRequired
            ? t('plugin_management.delete_restart_required')
            : t('plugin_management.delete_failed');
          showNotification(
            `${t('plugin_management.delete_failed')}: ${getErrorMessage(err, fallback)}`,
            restartRequired ? 'warning' : 'error'
          );
        } finally {
          setDeletingID('');
          setMutatingID('');
        }
      },
    });
  };

  return (
    <div className={styles.page}>
      {/* ── Page Header ── */}
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>{t('plugin_management.title')}</h1>
        <p className={styles.description}>{t('plugin_management.description')}</p>
      </div>

      {/* ── Alerts ── */}
      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {data && !data.pluginsEnabled ? (
        <div className={styles.warningBox}>{t('plugin_management.global_disabled_hint')}</div>
      ) : null}

      {/* ── Status Bar ── */}
      {data ? (
        <div className={styles.statusBar}>
          <div className={styles.statusPill}>
            <span
              className={`${styles.statusDot} ${
                data.pluginsEnabled ? styles.statusDotOn : styles.statusDotOff
              }`}
            />
            <span className={styles.statusLabel}>{t('plugin_management.global_status')}</span>
            <span className={styles.statusValue}>
              {data.pluginsEnabled
                ? t('plugin_management.global_enabled')
                : t('plugin_management.global_disabled')}
            </span>
          </div>

          <span className={styles.statusDivider} />

          <div className={styles.statusPill}>
            <span className={styles.statusLabel}>{t('plugin_management.plugins_dir')}</span>
            <span
              className={`${styles.statusValue} ${styles.statusPathValue}`}
              title={data.pluginsDir || 'plugins'}
            >
              {data.pluginsDir || 'plugins'}
            </span>
          </div>

          <span className={styles.statusDivider} />

          <div className={styles.statusPill}>
            <span className={styles.statusLabel}>{t('plugin_management.discovered')}</span>
            <span className={styles.statusValue}>{pluginStats.discovered}</span>
          </div>

          <span className={styles.statusDivider} />

          <div className={styles.statusPill}>
            <span className={styles.statusLabel}>{t('plugin_management.effective')}</span>
            <span className={styles.statusValue}>
              {pluginStats.effective}/{pluginStats.registered}
            </span>
          </div>
        </div>
      ) : null}

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <Input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('plugin_management.search_placeholder')}
          aria-label={t('plugin_management.search_label')}
          rightElement={<IconSearch size={16} />}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={loadPlugins}
          disabled={!connected || loading || Boolean(mutatingID || deletingID)}
          loading={loading}
        >
          <IconRefreshCw size={16} />
          {t('plugin_management.refresh')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate('/plugin-store')}>
          <IconSidebarStore size={16} />
          {t('plugin_store.title')}
        </Button>
      </div>

      {/* ── Plugin List ── */}
      {loading ? (
        <div className={styles.pluginList}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={styles.skeletonRow}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonText}>
                <div className={styles.skeletonLine} />
                <div className={styles.skeletonLine} />
              </div>
            </div>
          ))}
        </div>
      ) : visiblePlugins.length === 0 ? (
        <EmptyState
          title={t('plugin_management.no_plugins')}
          description={t('plugin_management.no_plugins_desc')}
          action={
            <Button variant="secondary" size="sm" onClick={loadPlugins} disabled={!connected}>
              <IconRefreshCw size={16} />
              {t('plugin_management.refresh')}
            </Button>
          }
        />
      ) : (
        <div className={styles.pluginList}>
          {visiblePlugins.map((plugin) => {
            const logo = resolvePluginAsset(getPluginLogo(plugin, logoEntries));
            const github = plugin.metadata?.githubRepository.trim();
            const openingConfig = editingPlugin?.id === plugin.id && configActivity === 'loading';
            const deletingPlugin = deletingID === plugin.id;
            const actionBusy = Boolean(mutatingID || configActivity || deletingID);
            const version = plugin.metadata?.version;
            const author = plugin.metadata?.author;

            return (
              <article key={plugin.id} className={styles.pluginRow}>
                {/* Logo */}
                <div className={styles.logoBox} aria-hidden="true">
                  <PluginCardLogo key={logo} src={logo} />
                </div>

                {/* Info */}
                <div className={styles.pluginInfo}>
                  <div className={styles.pluginName}>
                    <h2>{getPluginTitle(plugin)}</h2>
                    <div className={styles.badgeRow}>
                      <span
                        className={
                          plugin.effectiveEnabled ? styles.badgeSuccess : styles.badgeMuted
                        }
                      >
                        {plugin.effectiveEnabled
                          ? t('plugin_management.status_effective')
                          : t('plugin_management.status_inactive')}
                      </span>
                      <span className={plugin.registered ? styles.badge : styles.badgeWarning}>
                        {plugin.registered
                          ? t('plugin_management.registered')
                          : t('plugin_management.not_registered')}
                      </span>
                      <span className={plugin.configured ? styles.badge : styles.badgeMuted}>
                        {plugin.configured
                          ? t('plugin_management.configured')
                          : t('plugin_management.not_configured')}
                      </span>
                      {plugin.supportsOAuth ? (
                        <span className={styles.badge}>{t('plugin_management.oauth')}</span>
                      ) : null}
                    </div>
                  </div>

                  <span className={styles.pluginId}>{plugin.id}</span>

                  {version || author || plugin.path ? (
                    <div className={styles.pluginMeta}>
                      {version ? (
                        <span className={styles.metaItem}>
                          <strong>{version}</strong>
                        </span>
                      ) : null}
                      {version && author ? (
                        <span className={styles.metaDot} aria-hidden="true" />
                      ) : null}
                      {author ? <span className={styles.metaItem}>{author}</span> : null}
                      {(version || author) && plugin.path ? (
                        <span className={styles.metaDot} aria-hidden="true" />
                      ) : null}
                      {plugin.path ? (
                        <span
                          className={`${styles.metaItem} ${styles.metaPath}`}
                          title={plugin.path}
                        >
                          {plugin.path}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Actions */}
                <div className={styles.rowActions}>
                  <ToggleSwitch
                    checked={plugin.enabled}
                    onChange={(enabled) => handleTogglePlugin(plugin, enabled)}
                    disabled={!connected || actionBusy}
                    ariaLabel={t('plugin_management.enabled')}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openConfig(plugin)}
                    disabled={!connected || actionBusy}
                    loading={openingConfig}
                  >
                    <IconSettings size={14} />
                    {t('plugin_management.edit_config')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDeletePlugin(plugin)}
                    disabled={!connected || actionBusy}
                    loading={deletingPlugin}
                    title={t('plugin_management.delete_plugin')}
                    aria-label={t('plugin_management.delete_plugin')}
                  >
                    <IconTrash2 size={14} />
                    {t('plugin_management.delete_plugin')}
                  </Button>
                  {github ? (
                    <a
                      className={styles.iconLink}
                      href={github}
                      target="_blank"
                      rel="noreferrer"
                      title={t('plugin_management.open_repository')}
                      aria-label={t('plugin_management.open_repository')}
                    >
                      <IconGithub size={14} />
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <PluginConfigSheet
        plugin={editingPlugin}
        onClose={() => setEditingPlugin(null)}
        onActivityChange={setConfigActivity}
        onSaved={setData}
      />
    </div>
  );
}
