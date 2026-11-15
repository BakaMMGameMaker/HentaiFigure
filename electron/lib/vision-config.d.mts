type VisionConfig = { baseUrl: string; model: string; verifiedVision?: string };
type Connection = { baseUrl: string; model: string; apiKey: string };

export const DEEPSEEK_URL: string;
export const DEFAULT_VISION_MODEL: string;
export function isDeepSeekEndpoint(value: unknown): boolean;
export function migrateVisionModel(config: VisionConfig): string;
export function validateVisionModel(config: VisionConfig): void;
export function isVisionReady(config: VisionConfig): boolean;
export function assertVisionReady(config: VisionConfig): void;
export function connectionTestInput(current: Connection, input?: Partial<Connection>): Connection;
export function verifyVisionSettings(options: {
  current: Connection & VisionConfig;
  patch: Partial<Connection> & { clearApiKey?: boolean; verifyVision?: boolean };
  test: (connection: Connection) => Promise<unknown>;
}): Promise<string | undefined>;
export function runVisionCheck(options: {
  renderImage: (colors: string[]) => string;
  complete: (messages: { role: 'user'; content: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } })[] }[]) => Promise<string>;
}): Promise<string>;
