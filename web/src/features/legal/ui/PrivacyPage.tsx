import { privacyPolicy } from '../model/privacy';
import { LegalPage } from './LegalPage';

export function PrivacyPage() {
  return <LegalPage doc={privacyPolicy} />;
}
