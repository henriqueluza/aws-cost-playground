import { termsOfUse } from '../model/terms';
import { LegalPage } from './LegalPage';

export function TermsPage() {
  return <LegalPage doc={termsOfUse} />;
}
