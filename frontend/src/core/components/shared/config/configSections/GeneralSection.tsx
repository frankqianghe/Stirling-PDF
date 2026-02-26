import React from "react";
import { Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import SoftwareUpdatesSection from "@app/components/shared/config/configSections/SoftwareUpdatesSection";

interface GeneralSectionProps {
  hideTitle?: boolean;
}

const GeneralSection: React.FC<GeneralSectionProps> = ({ hideTitle = false }) => {
  const { t } = useTranslation();

  return (
    <Stack gap="lg">
      {!hideTitle && (
        <div>
          <Text fw={600} size="lg">
            {t("settings.general.title", "General")}
          </Text>
          <Text size="sm" c="dimmed">
            {t("settings.general.description", "Configure general application preferences.")}
          </Text>
        </div>
      )}

      <SoftwareUpdatesSection />
    </Stack>
  );
};

export default GeneralSection;

