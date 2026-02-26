import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { updateService, UpdateSummary } from "@app/services/updateService";
import UpdateModal from "@app/components/shared/UpdateModal";
import LocalIcon from "@app/components/shared/LocalIcon";
import { useAppConfig } from "@app/contexts/AppConfigContext";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

export const SoftwareUpdatesSection: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useAppConfig();
  const [updateSummary, setUpdateSummary] = useState<UpdateSummary | null>(null);
  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [mismatchVersion, setMismatchVersion] = useState(false);
  const isTauriApp = useMemo(() => isTauri(), []);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const frontendVersionLabel = appVersion ?? t("common.loading", "Loading...");

  const checkForUpdate = useCallback(async () => {
    if (!config?.appVersion || !config?.machineType) {
      return;
    }

    setCheckingUpdate(true);
    const machineInfo = {
      machineType: config.machineType,
      activeSecurity: config.activeSecurity ?? false,
      licenseType: config.license ?? "NORMAL",
    };

    const summary = await updateService.getUpdateSummary(config.appVersion, machineInfo);
    if (summary?.latest_version) {
      const isNewerVersion = updateService.compareVersions(summary.latest_version, config.appVersion) > 0;
      setUpdateSummary(isNewerVersion ? summary : null);
    } else {
      setUpdateSummary(null);
    }
    setCheckingUpdate(false);
  }, [config?.activeSecurity, config?.appVersion, config?.license, config?.machineType]);

  // Check for updates on mount (when we have enough backend config)
  useEffect(() => {
    if (config?.appVersion && config?.machineType) {
      checkForUpdate();
    }
  }, [config?.appVersion, config?.machineType, checkForUpdate]);

  useEffect(() => {
    if (!isTauriApp) {
      setMismatchVersion(false);
      return;
    }

    let cancelled = false;
    const fetchFrontendVersion = async () => {
      try {
        const frontendVersion = await getVersion();
        if (!cancelled) {
          setAppVersion(frontendVersion);
        }
      } catch (error) {
        console.error("[SoftwareUpdatesSection] Failed to fetch frontend version:", error);
      }
    };

    fetchFrontendVersion();
    return () => {
      cancelled = true;
    };
  }, [isTauriApp]);

  useEffect(() => {
    if (!isTauriApp) {
      return;
    }

    if (!appVersion || !config?.appVersion) {
      setMismatchVersion(false);
      return;
    }

    setMismatchVersion(appVersion !== config.appVersion);
  }, [isTauriApp, appVersion, config?.appVersion]);

  if (!config?.appVersion) {
    return null;
  }

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Stack gap="md">
          <div>
            <Group justify="space-between" align="center">
              <div>
                <Text fw={600} size="sm">
                  {t("settings.general.updates.title", "Software Updates")}
                </Text>
                <Text size="xs" c="dimmed" mt={4}>
                  {t("settings.general.updates.description", "Check for updates and view version information")}
                </Text>
              </div>
              {updateSummary && (
                <Badge color={updateSummary.max_priority === "urgent" ? "red" : "blue"} variant="filled">
                  {updateSummary.max_priority === "urgent"
                    ? t("update.urgentUpdateAvailable", "Urgent Update")
                    : t("update.updateAvailable", "Update Available")}
                </Badge>
              )}
            </Group>
          </div>

          {isTauriApp && (
            <div>
              <Text size="sm" c="dimmed">
                {t("settings.general.updates.currentFrontendVersion", "Current Frontend Version")}:{" "}
                <Text component="span" fw={500}>
                  {frontendVersionLabel}
                </Text>
              </Text>
              {mismatchVersion && (
                <Text size="sm" c="red" mt={4}>
                  {t(
                    "settings.general.updates.versionMismatch",
                    "Warning: A mismatch has been detected between the client version and the AppConfig version. Using different versions can lead to compatibility issues, errors, and security risks. Please ensure that server and client are using the same version."
                  )}
                </Text>
              )}
            </div>
          )}

          <Group justify="space-between" align="center">
            <div>
              <Text size="sm" c="dimmed">
                {t("settings.general.updates.currentBackendVersion", "Current Backend Version")}:{" "}
                <Text component="span" fw={500}>
                  {config.appVersion}
                </Text>
              </Text>
              {updateSummary && (
                <Text size="sm" c="dimmed" mt={4}>
                  {t("settings.general.updates.latestVersion", "Latest Version")}:{" "}
                  <Text component="span" fw={500} c="blue">
                    {updateSummary.latest_version}
                  </Text>
                </Text>
              )}
            </div>
            <Group gap="sm">
              <Button
                size="sm"
                variant="default"
                onClick={checkForUpdate}
                loading={checkingUpdate}
                leftSection={<LocalIcon icon="refresh-rounded" width="1rem" height="1rem" />}
              >
                {t("settings.general.updates.checkForUpdates", "Check for Updates")}
              </Button>
              {updateSummary && (
                <Button
                  size="sm"
                  color={updateSummary.max_priority === "urgent" ? "red" : "blue"}
                  onClick={() => setUpdateModalOpened(true)}
                  leftSection={<LocalIcon icon="system-update-alt-rounded" width="1rem" height="1rem" />}
                >
                  {t("settings.general.updates.viewDetails", "View Details")}
                </Button>
              )}
            </Group>
          </Group>

          {updateSummary?.any_breaking && (
            <Alert
              color="orange"
              title={t("update.breakingChangesDetected", "Breaking Changes Detected")}
              styles={{ title: { fontWeight: 600 } }}
            >
              <Text size="sm">
                {t(
                  "update.breakingChangesMessage",
                  "Some versions contain breaking changes. Please review the migration guides before updating."
                )}
              </Text>
            </Alert>
          )}
        </Stack>
      </Paper>

      {updateSummary && config?.appVersion && config?.machineType && (
        <UpdateModal
          opened={updateModalOpened}
          onClose={() => setUpdateModalOpened(false)}
          currentVersion={config.appVersion}
          updateSummary={updateSummary}
          machineInfo={{
            machineType: config.machineType,
            activeSecurity: config.activeSecurity ?? false,
            licenseType: config.license ?? "NORMAL",
          }}
        />
      )}
    </>
  );
};

export default SoftwareUpdatesSection;

