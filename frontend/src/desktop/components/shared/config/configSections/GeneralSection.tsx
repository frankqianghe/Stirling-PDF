import React from 'react';
import { Stack } from '@mantine/core';
import { DefaultAppSettings } from '@app/components/shared/config/configSections/DefaultAppSettings';
import SoftwareUpdatesSection from '@app/components/shared/config/configSections/SoftwareUpdatesSection';

/**
 * Desktop extension of GeneralSection that adds default PDF editor settings
 */
const GeneralSection: React.FC = () => {
  return (
    <Stack gap="lg">
      <DefaultAppSettings />
      <SoftwareUpdatesSection />
    </Stack>
  );
};

export default GeneralSection;
