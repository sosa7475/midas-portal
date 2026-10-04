import { Redirect } from 'expo-router';
import { useStore } from '../src/store';

export default function Index() {
  const token = useStore((s) => s.token);
  return <Redirect href={token ? '/(tabs)/chat' : '/(auth)/login'} />;
}
