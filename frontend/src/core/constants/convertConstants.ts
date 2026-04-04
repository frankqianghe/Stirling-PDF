
export const COLOR_TYPES = {
  COLOR: 'color',
  GRAYSCALE: 'grayscale',
  BLACK_WHITE: 'blackwhite'
} as const;

export const OUTPUT_OPTIONS = {
  SINGLE: 'single',
  MULTIPLE: 'multiple'
} as const;

export const FIT_OPTIONS = {
  FIT_PAGE: 'fitDocumentToPage',
  MAINTAIN_ASPECT: 'maintainAspectRatio',
  FILL_PAGE: 'fillPage'
} as const;


export const CONVERSION_ENDPOINTS = {
  'pdf-office-word': '/api/v1/convert/pdf/word',
  'pdf-office-presentation': '/api/v1/convert/pdf/presentation',
  'pdf-xlsx': '/api/v1/convert/pdf/xlsx',
} as const;

export const ENDPOINT_NAMES = {
  'pdf-office-word': 'pdf-to-word',
  'pdf-office-presentation': 'pdf-to-presentation',
  'pdf-xlsx': 'pdf-to-xlsx',
} as const;


// Grouped file extensions for dropdowns
export const FROM_FORMAT_OPTIONS = [
  { value: 'pdf', label: 'PDF', group: 'Document' },
];

export const TO_FORMAT_OPTIONS = [
  { value: 'docx', label: 'DOCX', group: 'Document' },
  { value: 'xlsx', label: 'XLSX', group: 'Spreadsheet' },
  { value: 'pptx', label: 'PPTX', group: 'Presentation' },
];

// Conversion matrix - what each source format can convert to
export const CONVERSION_MATRIX: Record<string, string[]> = {
  'pdf': ['docx', 'xlsx', 'pptx'],
};

// Map extensions to endpoint keys
export const EXTENSION_TO_ENDPOINT: Record<string, Record<string, string>> = {
  'pdf': {
    'docx': 'pdf-to-word',
    'pptx': 'pdf-to-presentation',
    'xlsx': 'pdf-to-xlsx',
  },
};

export type ColorType = typeof COLOR_TYPES[keyof typeof COLOR_TYPES];
export type OutputOption = typeof OUTPUT_OPTIONS[keyof typeof OUTPUT_OPTIONS];
export type FitOption = typeof FIT_OPTIONS[keyof typeof FIT_OPTIONS];
