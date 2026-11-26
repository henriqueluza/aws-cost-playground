import type { RouteObject } from 'react-router';
import { AccountPage } from '../features/account';
import { AuthCallbackPage } from '../features/auth';
import { ComparePage } from '../features/compare';
import { DesignsPage, SaveControls } from '../features/designs';
import { EditorPage } from '../features/editor';
import { PrivacyPage, TermsPage } from '../features/legal';

function EditorRoute() {
  return <EditorPage actions={<SaveControls />} />;
}

export const routes: RouteObject[] = [
  { path: '/', Component: EditorRoute },
  { path: '/designs', Component: DesignsPage },
  { path: '/comparar', Component: ComparePage },
  { path: '/conta', Component: AccountPage },
  { path: '/privacidade', Component: PrivacyPage },
  { path: '/termos', Component: TermsPage },
  { path: '/auth/callback', Component: AuthCallbackPage },
];
