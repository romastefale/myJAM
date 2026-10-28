interface TelegramWebApp {
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  onEvent(event: string, handler: () => void): void;
  Serverless: { call(name: string, input: object, callback: (error: Error | null, result: never) => void): void };
}
interface Window {
  Telegram: { WebApp: TelegramWebApp };
}
