import {
  CONVERSION_MATRIX,
} from '@app/constants/convertConstants';
import { getEndpointName as getEndpointNameUtil, getEndpointUrl, getAvailableToExtensions as getAvailableToExtensionsUtil } from '@app/utils/convertUtils';
import { detectFileExtension as detectFileExtensionUtil } from '@app/utils/fileUtils';
import { BaseParameters } from '@app/types/parameters';
import { useBaseParameters, BaseParametersHook } from '@app/hooks/tools/shared/useBaseParameters';
import { useCallback, useMemo } from 'react';

export interface ConvertParameters extends BaseParameters {
  fromExtension: string;
  toExtension: string;
}

export interface ConvertParametersHook extends BaseParametersHook<ConvertParameters> {
  getEndpoint: () => string;
  getAvailableToExtensions: (fromExtension: string) => Array<{value: string, label: string, group: string}>;
  analyzeFileTypes: (files: Array<{name: string}>) => void;
}

export const defaultParameters: ConvertParameters = {
  fromExtension: '',
  toExtension: '',
};

const validateParameters = (params: ConvertParameters): boolean => {
  const { fromExtension, toExtension } = params;

  if (!fromExtension || !toExtension) return false;

  const supportedToExtensions = CONVERSION_MATRIX[fromExtension] || [];
  return supportedToExtensions.includes(toExtension);
};

const getEndpointName = (params: ConvertParameters): string => {
  const { fromExtension, toExtension } = params;
  return getEndpointNameUtil(fromExtension, toExtension);
};

export const useConvertParameters = (): ConvertParametersHook => {
  const config = useMemo(() => ({
    defaultParameters,
    endpointName: getEndpointName,
    validateFn: validateParameters,
  }), []);

  const baseHook = useBaseParameters(config);

  const getEndpoint = () => {
    const { fromExtension, toExtension } = baseHook.parameters;
    return getEndpointUrl(fromExtension, toExtension);
  };

  const getAvailableToExtensions = getAvailableToExtensionsUtil;


  const analyzeFileTypes = useCallback((files: Array<{name: string}>) => {
    if (files.length === 0) {
      return;
    }

    const detectedExt = detectFileExtensionUtil(files[0].name);
    const availableTargets = detectedExt ? CONVERSION_MATRIX[detectedExt] || [] : [];

    if (availableTargets.length === 0) return;

    baseHook.setParameters(prev => {
      const currentToExt = prev.toExtension;
      const isCurrentToExtValid = availableTargets.includes(currentToExt);

      let newToExtension = currentToExt;
      if (!currentToExt || !isCurrentToExtValid) {
        newToExtension = availableTargets.length === 1 ? availableTargets[0] : '';
      }

      const newState = {
        ...prev,
        fromExtension: detectedExt,
        toExtension: newToExtension
      };

      if (
        prev.fromExtension === newState.fromExtension &&
        prev.toExtension === newState.toExtension
      ) {
        return prev;
      }

      return newState;
    });
  }, [baseHook.setParameters]);

  return {
    ...baseHook,
    getEndpoint,
    getAvailableToExtensions,
    analyzeFileTypes,
  };
};
