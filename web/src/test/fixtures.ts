import { vi } from 'vitest';

export const validConfig = {
  apiBaseUrl: 'https://api.example.com',
  cognitoAuthority: 'https://cognito-idp.us-east-1.amazonaws.com/pool',
  cognitoClientId: 'abc_123-XYZ',
  selfSignupEnabled: false,
};
export const reply = (body: string, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(body, { status })));
