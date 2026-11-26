import type { RouteObject } from 'react-router';
import { AccountPage } from '../features/account';
import { AuthActions, AuthCallbackPage, RequireAuth, SignInButton } from '../features/auth';
import { CompareLink, ComparePage } from '../features/compare';
import { DesignsPage, SaveControls } from '../features/designs';
import { EditorPage, keepDesignForLogin } from '../features/editor';
import { PrivacyPage, TermsPage } from '../features/legal';

/** O app compõe a barra do editor: salvar (designs) e a conta (auth); o editor não conhece nenhum dos dois. */
function EditorRoute() {
  return (
    <EditorPage
      actions={
        <>
          <CompareLink />
          <SaveControls signInAction={<SignInButton beforeSignIn={keepDesignForLogin} />} />
          <AuthActions beforeSignIn={keepDesignForLogin} />
        </>
      }
    />
  );
}

export const routes: RouteObject[] = [
  { path: '/', Component: EditorRoute },
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
