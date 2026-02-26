import React from 'react';
import { Stack } from '@mantine/core';
import { DefaultAppSettings } from '@app/components/shared/config/configSections/DefaultAppSettings';

/**
 * Desktop GeneralSection: only Default PDF editor.
 * Check-for-updates (Software Updates) is hidden in this build.
 */
const GeneralSection: React.FC = () => {
  return (
    <Stack gap="lg">
      <DefaultAppSettings />
    </Stack>
  );
};

export default GeneralSection;
