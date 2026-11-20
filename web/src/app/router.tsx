import type { RouteObject } from 'react-router';
import { AccountPage } from '../features/account';
import { AuthCallbackPage } from '../features/auth';
import { ComparePage } from '../features/compare';
import { DesignsPage } from '../features/designs';
import { EditorPage } from '../features/editor';
import { PrivacyPage, TermsPage } from '../features/legal';

export const routes: RouteObject[] = [
  { path: '/', Component: EditorPage },
  { path: '/designs', Component: DesignsPage },
  { path: '/comparar', Component: ComparePage },
  { path: '/conta', Component: AccountPage },
  { path: '/privacidade', Component: PrivacyPage },
  { path: '/termos', Component: TermsPage },
  { path: '/auth/callback', Component: AuthCallbackPage },
];
