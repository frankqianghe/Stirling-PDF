import { useMemo } from "react";
import { Stack, Text, Group, UnstyledButton, useMantineTheme, useMantineColorScheme } from "@mantine/core";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { useTranslation } from "react-i18next";
import { useFileSelection } from "@app/contexts/FileContext";
import { useFileState } from "@app/contexts/FileContext";
import { detectFileExtension } from "@app/utils/fileUtils";
import GroupedFormatDropdown from "@app/components/tools/convert/GroupedFormatDropdown";
import { ConvertParameters } from "@app/hooks/tools/convert/useConvertParameters";
import {
  FROM_FORMAT_OPTIONS,
} from "@app/constants/convertConstants";
import { StirlingFile } from "@app/types/fileContext";

interface ConvertSettingsProps {
  parameters: ConvertParameters;
  onParameterChange: <K extends keyof ConvertParameters>(key: K, value: ConvertParameters[K]) => void;
  getAvailableToExtensions: (fromExtension: string) => Array<{value: string, label: string, group: string}>;
  selectedFiles: StirlingFile[];
  disabled?: boolean;
}

const ConvertSettings = ({
  parameters,
  onParameterChange,
  getAvailableToExtensions,
  selectedFiles,
  disabled = false
}: ConvertSettingsProps) => {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const { setSelectedFiles } = useFileSelection();
  const { state, selectors } = useFileState();
  const activeFiles = state.files.ids;

  const enhancedFromOptions = useMemo(() => {
    return FROM_FORMAT_OPTIONS.map(option => ({
      ...option,
      enabled: true
    }));
  }, []);

  const enhancedToOptions = useMemo(() => {
    if (!parameters.fromExtension) return [];
    return getAvailableToExtensions(parameters.fromExtension).map(option => ({
      ...option,
      enabled: true
    }));
  }, [parameters.fromExtension]);

  const resetParametersToDefaults = () => {
    // No format-specific options needed for docx/xlsx/pptx output
  };

  const setAutoTargetExtension = (fromExtension: string) => {
    const availableToOptions = getAvailableToExtensions(fromExtension);
    const autoTarget = availableToOptions.length === 1 ? availableToOptions[0].value : '';
    onParameterChange('toExtension', autoTarget);
  };

  const filterFilesByExtension = (extension: string) => {
    const files = activeFiles.map(fileId => selectors.getFile(fileId)).filter(Boolean) as StirlingFile[];
    return files.filter(file => {
      const fileExtension = detectFileExtension(file.name);
      return fileExtension === extension;
    });
  };

  const updateFileSelection = (files: StirlingFile[]) => {
    const fileIds = files.map(file => file.fileId);
    setSelectedFiles(fileIds);
  };

  const handleFromExtensionChange = (value: string) => {
    onParameterChange('fromExtension', value);
    setAutoTargetExtension(value);
    resetParametersToDefaults();

    if (activeFiles.length > 0) {
      const matchingFiles = filterFilesByExtension(value);
      updateFileSelection(matchingFiles);
    } else {
      updateFileSelection([]);
    }
  };

  const handleToExtensionChange = (value: string) => {
    onParameterChange('toExtension', value);
  };


  return (
    <Stack gap="md">

      {/* Format Selection */}
      <Stack gap="sm">
        <Text size="sm" fw={500}>
          {t("convert.convertFrom", "Convert from")}:
        </Text>
        <GroupedFormatDropdown
          name="convert-from-dropdown"
          data-testid="convert-from-dropdown"
          value={parameters.fromExtension}
          placeholder={t("convert.sourceFormatPlaceholder", "Source format")}
          options={enhancedFromOptions}
          onChange={handleFromExtensionChange}
          disabled={disabled}
          minWidth="18rem"
        />
      </Stack>

      <Stack gap="sm">
        <Text size="sm" fw={500}>
          {t("convert.convertTo", "Convert to")}:
        </Text>
        {!parameters.fromExtension ? (
          <UnstyledButton
            style={{
              padding: '0.5rem 0.75rem',
              border: `0.0625rem solid ${theme.colors.gray[4]}`,
              borderRadius: theme.radius.sm,
              backgroundColor: colorScheme === 'dark' ? theme.colors.dark[5] : theme.colors.gray[1],
              color: colorScheme === 'dark' ? theme.colors.dark[2] : theme.colors.gray[6],
              cursor: 'not-allowed'
            }}
          >
            <Group justify="space-between">
              <Text size="sm">{t("convert.selectSourceFormatFirst", "Select a source format first")}</Text>
              <KeyboardArrowDownIcon
                style={{
                  fontSize: '1rem',
                  color: colorScheme === 'dark' ? theme.colors.dark[2] : theme.colors.gray[6]
                }}
              />
            </Group>
          </UnstyledButton>
        ) : (
          <GroupedFormatDropdown
            name="convert-to-dropdown"
            data-testid="convert-to-dropdown"
            value={parameters.toExtension}
            placeholder={t("convert.targetFormatPlaceholder", "Target format")}
            options={enhancedToOptions}
            onChange={handleToExtensionChange}
            disabled={disabled}
            minWidth="18rem"
          />
        )}
      </Stack>


    </Stack>
  );
};

export default ConvertSettings;
