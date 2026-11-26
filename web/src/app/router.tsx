import type { RouteObject } from 'react-router';
import { AccountPage } from '../features/account';
import { AuthCallbackPage, RequireAuth } from '../features/auth';
import { ComparePage } from '../features/compare';
import { DesignsPage } from '../features/designs';
import { EditorPage } from '../features/editor';
import { PrivacyPage, TermsPage } from '../features/legal';

export const routes: RouteObject[] = [
  { path: '/', Component: EditorPage },
  {
    path: '/designs',
    element: (
      <RequireAuth>
        <DesignsPage />
      </RequireAuth>
    ),
  },
  { path: '/comparar', Component: ComparePage },
  {
    path: '/conta',
    element: (
      <RequireAuth>
        <AccountPage />
      </RequireAuth>
    ),
  },
  { path: '/privacidade', Component: PrivacyPage },
  { path: '/termos', Component: TermsPage },
  { path: '/auth/callback', Component: AuthCallbackPage },
];
