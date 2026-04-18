import React, { useState, useEffect } from 'react';
import { Center, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useDocumentManagerPlugin } from '@embedpdf/plugin-document-manager/react';

interface DocumentReadyWrapperProps {
  children: (documentId: string) => React.ReactNode;
  fallback?: React.ReactNode;
}

interface DocumentErrorState {
  documentId: string;
  message: string;
  code?: number;
}

// PdfErrorCode.Password from @embedpdf/models. Inlined to avoid a heavy import
// and keep the wrapper dependency-light.
const PDF_ERROR_CODE_PASSWORD = 4;
const PDF_ERROR_CODE_SECURITY = 5;

export function DocumentReadyWrapper({ children, fallback = null }: DocumentReadyWrapperProps) {
  const { t } = useTranslation();
  const { plugin, isLoading, ready } = useDocumentManagerPlugin();
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<DocumentErrorState | null>(null);

  useEffect(() => {
    if (isLoading || !plugin) return;

    const checkActiveDocument = async () => {
      await ready;

      // Try to get the active document from the plugin's provides()
      const docManagerApi = plugin.provides?.();
      if (docManagerApi) {
        // Try different methods to get the active document
        const activeDoc = docManagerApi.getActiveDocument?.();
        if (activeDoc?.id) {
          setActiveDocumentId(activeDoc.id);
          setDocumentError(null);
          return;
        }
      }
    };

    checkActiveDocument();

    // Subscribe to document changes
    const docManagerApi = plugin.provides?.();
    const unsubscribers: Array<() => void> = [];

    if (docManagerApi?.onDocumentOpened) {
      const unsubscribe = docManagerApi.onDocumentOpened((event: any) => {
        const docId = event?.documentId || event?.id || event?.document?.id;
        if (docId) {
          setActiveDocumentId(docId);
          setDocumentError(null);
        }
      });
      if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
    }

    // Subscribe to document load errors so we can show a meaningful message
    // instead of hanging in the loading fallback forever (e.g. the user just
    // encrypted a PDF and pdfium can't open the new password-protected file).
    if (docManagerApi?.onDocumentError) {
      const unsubscribe = docManagerApi.onDocumentError((event: any) => {
        if (!event?.documentId) return;
        setDocumentError({
          documentId: event.documentId,
          message: event.message || 'Failed to load document',
          code: event.code,
        });
      });
      if (typeof unsubscribe === 'function') unsubscribers.push(unsubscribe);
    }

    return () => {
      for (const unsubscribe of unsubscribers) {
        try { unsubscribe(); } catch { /* ignore */ }
      }
    };
  }, [plugin, isLoading, ready]);

  if (documentError && (!activeDocumentId || activeDocumentId === documentError.documentId)) {
    const isPasswordProtected =
      documentError.code === PDF_ERROR_CODE_PASSWORD ||
      documentError.code === PDF_ERROR_CODE_SECURITY;
    const title = isPasswordProtected
      ? t('viewer.passwordProtectedTitle', 'Password-protected PDF')
      : t('viewer.cannotPreviewFile', 'Cannot Preview File');
    const description = isPasswordProtected
      ? t(
          'viewer.passwordProtectedDescription',
          'This PDF is encrypted. Remove the password using the "Remove Password" tool to preview it here.'
        )
      : documentError.message;

    return (
      <Center h="100%" w="100%" p="md">
        <Stack align="center" gap="sm" style={{ maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>{isPasswordProtected ? '🔒' : '⚠️'}</div>
          <Text fw={600}>{title}</Text>
          <Text c="dimmed" size="sm">{description}</Text>
        </Stack>
      </Center>
    );
  }

  if (!activeDocumentId) {
    return <>{fallback}</>;
  }

  return <>{children(activeDocumentId)}</>;
}
