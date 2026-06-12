import fs from 'fs/promises';
import path from 'path';

export interface AppConfig {
  meta: {
    accessToken: string;
    appId: string;
    appSecret: string;
    adAccountId: string;
  };
  shop: {
    platform: 'shopify' | 'shopline';
    domain: string;
    accessToken: string;
  };
  ai: {
    provider: 'openai' | 'gemini' | 'claude';
    apiKey: string;
    modelName: string;
  };
}

const defaultConfig: AppConfig = {
  meta: { accessToken: '', appId: '', appSecret: '', adAccountId: '' },
  shop: { platform: 'shopify', domain: '', accessToken: '' },
  ai: { provider: 'openai', apiKey: '', modelName: 'gpt-4o' }
};

const configPath = path.join(process.cwd(), 'data', 'config.json');

export class ConfigManager {
  static async load(): Promise<AppConfig> {
    try {
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      const data = await fs.readFile(configPath, 'utf-8');
      return { ...defaultConfig, ...JSON.parse(data) };
    } catch (e) {
      return defaultConfig;
    }
  }

  static async save(config: AppConfig): Promise<void> {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }
}
