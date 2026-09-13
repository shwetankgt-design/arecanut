import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gtbharat.arecanutsurvey',
  appName: 'Arecanut Farmer Survey',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
};

export default config;
