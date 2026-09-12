import { logOut } from '@/modules/auth/actions';

/** The sign-out control in the top bar is a plain form post, so it works without JS. */
export async function POST() {
  await logOut();
}
