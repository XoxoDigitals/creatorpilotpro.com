import { redirect } from 'next/navigation';

/** Root route — until auth lands (task #4), send visitors to the login placeholder. */
export default function RootPage() {
  redirect('/login');
}
