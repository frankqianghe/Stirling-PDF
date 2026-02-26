import { Flex } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useFooterInfo } from '@app/hooks/useFooterInfo';

interface FooterProps {
  privacyPolicy?: string;
  termsAndConditions?: string;
  forceLightMode?: boolean;
}

export default function Footer({
  privacyPolicy,
  termsAndConditions,
  forceLightMode = false
}: FooterProps) {
  const { t } = useTranslation();
  const { footerInfo } = useFooterInfo();

  // Use props if provided, otherwise fall back to fetched footer info
  const finalPrivacyPolicy = privacyPolicy ?? footerInfo?.privacyPolicy;
  const finalTermsAndConditions = termsAndConditions ?? footerInfo?.termsAndConditions;

  // Default URLs
  const defaultTermsUrl = "https://www.stirling.com/legal/terms-of-service";
  const defaultPrivacyUrl = "https://www.stirling.com/legal/privacy-policy";

  // Use provided URLs or fall back to defaults
  const finalTermsUrl = finalTermsAndConditions || defaultTermsUrl;
  const finalPrivacyUrl = finalPrivacyPolicy || defaultPrivacyUrl;

  return (
    <div style={{
      height: 'var(--footer-height)',
      backgroundColor: forceLightMode ? '#f1f3f5' : 'var(--mantine-color-gray-1)',
      borderTop: forceLightMode ? '1px solid #e9ecef' : '1px solid var(--mantine-color-gray-2)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}>
        <Flex gap="md"
          justify="center"
          align="center"
          direction="row"
          style={{
            fontSize: '0.75rem',
            color: forceLightMode ? '#495057' : undefined
          }}>
          <a
            className="footer-link px-3"
            target="_blank"
            rel="noopener noreferrer"
            href={finalPrivacyUrl}
          >
            {t('legal.privacy', 'Privacy Policy')}
          </a>
          <a
            className="footer-link px-3"
            target="_blank"
            rel="noopener noreferrer"
            href={finalTermsUrl}
          >
            {t('legal.terms', 'Terms and Conditions')}
          </a>
        </Flex>
    </div>
  );
}
